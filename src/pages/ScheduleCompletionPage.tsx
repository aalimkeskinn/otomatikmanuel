// --- START OF FILE src/pages/ScheduleCompletionPage.tsx (TAM VE SON HALİ) ---

import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrainCircuit, CheckCircle, Hourglass, ListTodo, Save, Eye, LayoutGrid, ArrowLeft, Info, AlertCircle, Search, X, Zap } from 'lucide-react';
import { UnassignedLesson } from '../types/wizard';
import Button from '../components/UI/Button';
import { useFirestore } from '../hooks/useFirestore';
import { Schedule, Teacher, Class, Subject, DAYS, PERIODS, ScheduleSlot } from '../types';
import { TimeConstraint } from '../types/constraints';
import ScheduleComparisonView from '../components/completion/ScheduleComparisonView';
import FullSchoolView from '../components/completion/FullSchoolView';
import { doc, writeBatch, collection, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useToast } from '../hooks/useToast';
import { useConfirmation } from '../hooks/useConfirmation';

const ScheduleCompletionPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { success, error, info, warning } = useToast();
  const { showConfirmation } = useConfirmation();

  const { data: teachers, loading: loadingT } = useFirestore<Teacher>('teachers');
  const { data: classes, loading: loadingC } = useFirestore<Class>('classes');
  const { data: subjects, loading: loadingS } = useFirestore<Subject>('subjects');
  const { data: allSchedules } = useFirestore<Schedule>('schedules');
  const { data: constraints, loading: loadingCon } = useFirestore<TimeConstraint>('constraints');

  const [unassignedLessons, setUnassignedLessons] = useState<UnassignedLesson[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<UnassignedLesson | null>(null);
  const [workingSchedules, setWorkingSchedules] = useState<Schedule[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'focus' | 'overview'>('focus');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAutoPlacing, setIsAutoPlacing] = useState(false);
  
  useEffect(() => {
    if (location.state?.unassignedLessons) {
      const initialLessons: UnassignedLesson[] = location.state.unassignedLessons;
      setUnassignedLessons(initialLessons);
      if (initialLessons.length > 0 && !selectedLesson) {
        setSelectedLesson(initialLessons[0]);
      }
    }
  }, [location.state]);

  useEffect(() => {
    if (allSchedules) {
      setWorkingSchedules(JSON.parse(JSON.stringify(allSchedules)));
    }
  }, [allSchedules]);
  
  const createEmptyScheduleGrid = (): Schedule['schedule'] => {
    const grid: Schedule['schedule'] = {};
    DAYS.forEach(day => {
      grid[day] = {};
      PERIODS.forEach(period => { grid[day][period] = null; });
    });
    return grid;
  };

  const assignLessonToSlot = (lesson: UnassignedLesson, day: string, period: string) => {
    setWorkingSchedules(prevSchedules => {
        const newSchedules = JSON.parse(JSON.stringify(prevSchedules));
        let teacherSched = newSchedules.find((s: Schedule) => s.teacherId === lesson.teacherId);
        
        if (!teacherSched) {
            teacherSched = { 
                id: `new-${lesson.teacherId}`,
                teacherId: lesson.teacherId, 
                schedule: createEmptyScheduleGrid(),
                isNew: true
            };
            newSchedules.push(teacherSched);
        }
        
        teacherSched.schedule[day][period] = {
            classId: lesson.classId,
            subjectId: lesson.subjectId,
        };
        return newSchedules;
    });
  };

  const clearSlotFromSchedule = (teacherId: string, day: string, period: string) => {
    setWorkingSchedules(prevSchedules => {
        const newSchedules = JSON.parse(JSON.stringify(prevSchedules));
        let teacherSched = newSchedules.find((s: Schedule) => s.teacherId === teacherId);
        if(teacherSched && teacherSched.schedule[day]) {
            teacherSched.schedule[day][period] = null;
        }
        return newSchedules;
    });
  };

  const handleSlotAssign = (day: string, period: string) => {
    if (!selectedLesson || selectedLesson.missingHours === 0) return;
    
    assignLessonToSlot(selectedLesson, day, period);

    const updatedLessons = unassignedLessons.map(lesson => 
      lesson === selectedLesson ? { ...lesson, missingHours: lesson.missingHours - 1 } : lesson
    ).filter(l => l.missingHours > 0);

    setUnassignedLessons(updatedLessons);
    setSelectedLesson(updatedLessons.find(l => l === selectedLesson) || updatedLessons[0] || null);
    info("Ders Atandı", `${selectedLesson.subjectName} dersi ${day} ${period}. saate atandı.`);
  };

  const handleSwapRequest = (day: string, period: string, conflictingSlot: ScheduleSlot) => {
    if (!selectedLesson || !conflictingSlot.subjectId || !conflictingSlot.classId || !conflictingSlot.teacherId) return;

    const targetSubject = subjects.find(s => s.id === conflictingSlot.subjectId);
    const targetClass = classes.find(c => c.id === conflictingSlot.classId);
    const targetTeacher = teachers.find(t => t.id === conflictingSlot.teacherId);

    if (!targetSubject || !targetClass || !targetTeacher) return;

    showConfirmation({
        title: 'Ders Takası Onayı',
        message: `Bu saatte ${targetClass.name} sınıfının ${targetSubject.name} dersi bulunmaktadır.\n\nBu dersi "Yerleştirilecekler" listesine gönderip, yerine ${selectedLesson.subjectName} dersini atamak istediğinizden emin misiniz?`,
        type: 'warning',
        confirmText: 'Evet, Takas Et',
        confirmVariant: 'danger',
    }, () => {
        clearSlotFromSchedule(targetTeacher.id, day, period);
        assignLessonToSlot(selectedLesson, day, period);
        const newUnassignedLesson: UnassignedLesson = {
            classId: targetClass.id,
            className: targetClass.name,
            subjectId: targetSubject.id,
            subjectName: targetSubject.name,
            teacherId: targetTeacher.id,
            teacherName: targetTeacher.name,
            missingHours: 1, 
            totalHours: targetSubject.weeklyHours
        };
        const updatedOldLessons = unassignedLessons.map(lesson => 
          lesson === selectedLesson ? { ...lesson, missingHours: lesson.missingHours - 1 } : lesson
        ).filter(l => l.missingHours > 0);

        const finalUnassigned = [...updatedOldLessons, newUnassignedLesson];
        setUnassignedLessons(finalUnassigned);
        
        setSelectedLesson(finalUnassigned.find(l => l === selectedLesson) || finalUnassigned[0] || null);

        info("Ders Takası Yapıldı", `${targetSubject.name} dersi yeniden yerleştirilmek üzere listeye eklendi.`);
    });
  };

  // Otomatik yerleştirme fonksiyonu
  const handleAutoPlacement = async () => {
    if (unassignedLessons.length === 0) {
      warning("Yerleştirilecek Ders Yok", "Tüm dersler zaten yerleştirilmiş.");
      return;
    }

    setIsAutoPlacing(true);
    info("Otomatik Yerleştirme Başlatıldı", "Dersler en uygun boşluklara yerleştirilmeye çalışılıyor...");

    try {
      // Yerleştirilecek derslerin kopyasını oluştur
      let remainingLessons = [...unassignedLessons];
      let placedCount = 0;
      
      // 1. Önce anaokulu derslerini yerleştir
      const anaokulLessons = remainingLessons.filter(lesson => {
        const classItem = classes.find(c => c.id === lesson.classId);
        return classItem && (classItem.level === 'Anaokulu' || (classItem.levels || []).includes('Anaokulu'));
      });
      
      // 2. Sonra sınıf öğretmeni derslerini yerleştir
      const classTeacherLessons = remainingLessons.filter(lesson => {
        if (anaokulLessons.includes(lesson)) return false;
        const classItem = classes.find(c => c.id === lesson.classId);
        return classItem && classItem.classTeacherId === lesson.teacherId;
      });
      
      // 3. Son olarak diğer dersleri yerleştir
      const otherLessons = remainingLessons.filter(lesson => 
        !anaokulLessons.includes(lesson) && !classTeacherLessons.includes(lesson)
      );
      
      // Önce anaokulu derslerini, sonra sınıf öğretmeni derslerini, en son diğer dersleri işle
      const processingOrder = [...anaokulLessons, ...classTeacherLessons, ...otherLessons];
      
      console.log(`🔄 Yerleştirilecek dersler: ${processingOrder.length} (Anaokulu: ${anaokulLessons.length}, Sınıf Öğretmeni: ${classTeacherLessons.length}, Diğer: ${otherLessons.length})`);
      
      // Her ders için tüm olası slotları kontrol et
      for (const lesson of processingOrder) {
        if (lesson.missingHours <= 0) continue;

        // Öğretmen ve sınıf programlarını al
        const teacherSchedule = workingSchedules.find(s => s.teacherId === lesson.teacherId)?.schedule || createEmptyScheduleGrid();
        const classSchedule: Schedule['schedule'] = createEmptyScheduleGrid();
        
        workingSchedules.forEach(s => {
          Object.entries(s.schedule).forEach(([day, daySlots]) => {
            if (daySlots) {
              Object.entries(daySlots).forEach(([period, slot]) => {
                if (slot?.classId === lesson.classId) {
                  if (!classSchedule[day]) classSchedule[day] = {};
                  classSchedule[day][period] = { ...slot, teacherId: s.teacherId };
                }
              });
            }
          });
        });

        // Tüm günleri ve periyotları kontrol et
        let lessonPlaced = false;
        
        // Sınıf anaokulu mu kontrol et
        const classItem = classes.find(c => c.id === lesson.classId);
        const isAnaokulu = classItem && (classItem.level === 'Anaokulu' || (classItem.levels || []).includes('Anaokulu'));
        const isClassTeacher = classItem && classItem.classTeacherId === lesson.teacherId;
        
        // Günleri sırala - anaokulu ve sınıf öğretmenleri için sabah saatlerini önceliklendir
        const dayOrder = [...DAYS];
        if (!isAnaokulu && !isClassTeacher) {
          // Anaokulu veya sınıf öğretmeni değilse günleri karıştır
          dayOrder.sort(() => Math.random() - 0.5);
        }
        
        for (const day of dayOrder) {
          if (lessonPlaced) break;
          
          // Periyotları sırala - anaokulu ve sınıf öğretmenleri için sabah saatlerini önceliklendir
          const periodOrder = [...PERIODS];
          if (isAnaokulu || isClassTeacher) {
            // Anaokulu ve sınıf öğretmenleri için sabah saatlerini önceliklendir
            periodOrder.sort((a, b) => {
              const aNum = parseInt(a);
              const bNum = parseInt(b);
              if (isNaN(aNum) || isNaN(bNum)) return 0;
              return aNum - bNum; // Küçük sayılar (sabah saatleri) önce
            });
          } else {
            // Diğer öğretmenler için periyotları karıştır
            periodOrder.sort(() => Math.random() - 0.5);
          }
          
          // Günlük ders sayısını kontrol et
          let dailyCount = 0;
          periodOrder.forEach(p => {
            if (teacherSchedule[day]?.[p]?.classId === lesson.classId) {
              dailyCount++;
            }
          });
          
          // Anaokulu ve sınıf öğretmenleri için günlük limit daha yüksek
          const dailyLimit = isAnaokulu ? 12 : isClassTeacher ? 8 : 4;
          
          // Günlük limit aşıldıysa bu günü atla
          if (dailyCount >= dailyLimit && !isAnaokulu) {
            continue;
          }
          
          for (const period of periodOrder) {
            // Öğretmen ve sınıf bu slotta müsait mi kontrol et
            const teacherSlot = teacherSchedule[day]?.[period];
            const classSlot = classSchedule[day]?.[period];
            
            if (!teacherSlot && !classSlot) {
              // Slot boş, dersi yerleştir
              assignLessonToSlot(lesson, day, period);
              
              // Yerleştirilen dersi güncelle
              remainingLessons = remainingLessons.map(l => {
                if (l === lesson) {
                  return { ...l, missingHours: l.missingHours - 1 };
                }
                return l;
              }).filter(l => l.missingHours > 0);
              
              placedCount++;
              lessonPlaced = true;
              break;
            }
          }
        }
      }

      // Yerleştirilemeyen dersleri güncelle
      setUnassignedLessons(remainingLessons);
      
      if (remainingLessons.length === 0) {
        success("✅ Tüm Dersler Yerleştirildi", `${placedCount} ders saati başarıyla yerleştirildi.`);
      } else if (placedCount > 0) {
        info("🔄 Kısmen Yerleştirildi", `${placedCount} ders saati yerleştirildi, ${remainingLessons.length} ders hala yerleştirilmeyi bekliyor.`);
      } else {
        warning("⚠️ Yerleştirilemedi", "Hiçbir ders yerleştirilemedi. Uygun boş slot bulunamadı.");
      }
      
      // Seçili dersi güncelle
      setSelectedLesson(remainingLessons[0] || null);
      
    } catch (err) {
      console.error("Otomatik yerleştirme hatası:", err);
      error("❌ Yerleştirme Hatası", "Dersler yerleştirilirken bir hata oluştu.");
    } finally {
      setIsAutoPlacing(false);
    }
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
        const batch = writeBatch(db);
        for (const schedule of workingSchedules) {
            const { isNew, ...scheduleData } = schedule as any;
            const originalSchedule = allSchedules.find(s => s.id === schedule.id);
            if (isNew && !originalSchedule) {
                const newDocRef = doc(collection(db, "schedules"));
                batch.set(newDocRef, { ...scheduleData, teacherId: schedule.id.replace('new-',''), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
            } else if (originalSchedule && JSON.stringify(originalSchedule.schedule) !== JSON.stringify(schedule.schedule)) {
                const docRef = doc(db, "schedules", schedule.id);
                batch.update(docRef, { schedule: schedule.schedule, updatedAt: Timestamp.now() });
            }
        }
        await batch.commit();
        success("Kaydedildi!", "Tüm değişiklikler başarıyla kaydedildi.");
        navigate('/all-schedules');
    } catch(e) {
        error("Kayıt Hatası", "Değişiklikler kaydedilirken bir hata oluştu.");
        console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  // Arama filtreleme fonksiyonu
  const filteredUnassignedLessons = useMemo(() => {
    if (!searchQuery.trim()) return unassignedLessons;
    
    return unassignedLessons.filter(lesson => 
      lesson.className.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lesson.subjectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lesson.teacherName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [unassignedLessons, searchQuery]);

  const isLoading = loadingT || loadingC || loadingS || !allSchedules || !constraints;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 border-4 border-t-blue-600 border-b-blue-600 border-l-gray-200 border-r-gray-200 rounded-full animate-spin"></div>
          <h2 className="text-lg font-semibold text-gray-800">Veriler Yükleniyor</h2>
          <p className="text-gray-600 mt-1">Lütfen bekleyin...</p>
        </div>
      </div>
    );
  }
  
  if (!location.state?.unassignedLessons) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md max-w-md w-full p-6 text-center border border-gray-200">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-6 w-6 text-gray-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Veri Bulunamadı</h2>
          <p className="text-gray-600 mb-4">Bu sayfaya doğrudan erişilemez. Lütfen sihirbazdan yönlendirmeyi kullanın.</p>
          <Button 
            onClick={() => navigate('/schedule-wizard')} 
            variant="primary" 
            className="w-full"
            icon={ArrowLeft}
          >
            Sihirbaza Geri Dön
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header - Daha kompakt */}
      <div className="bg-white shadow-sm border-b p-2 flex items-center justify-between flex-wrap gap-2 sticky top-0 z-20">
        <div className="flex items-center">
          <div className="w-6 h-6 bg-gray-100 rounded-lg flex items-center justify-center mr-2">
            <BrainCircuit className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900">Yardımcı Atama Modülü</h1>
            <p className="text-xs text-gray-600">
              {unassignedLessons.filter(l => l.missingHours > 0).length} dersin yerleşimi tamamlanacak
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button 
            variant="secondary" 
            onClick={() => navigate('/schedule-wizard')}
            icon={ArrowLeft}
            size="sm"
          >
            Geri
          </Button>
          <Button 
            variant="primary" 
            icon={Save} 
            onClick={handleSaveAll} 
            disabled={isSaving}
            size="sm"
          >
            {isSaving ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
      </div>

      {/* Main Content - Daha kompakt */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-2 p-2 overflow-hidden">
        {/* Left Sidebar - Unassigned Lessons - Daha kompakt */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow-sm border border-gray-200 p-2 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold flex items-center text-gray-800">
              <ListTodo className="w-4 h-4 mr-1 text-blue-600" />
              Yerleştirilecek Dersler
            </h2>
            <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">
              {filteredUnassignedLessons.length}
            </span>
          </div>

          {/* Otomatik Yerleştirme Butonu */}
          {filteredUnassignedLessons.length > 0 && (
            <div className="mb-2">
              <Button
                onClick={handleAutoPlacement}
                icon={Zap}
                variant="primary"
                size="sm"
                disabled={isAutoPlacing}
                className="w-full"
              >
                {isAutoPlacing ? "Yerleştiriliyor..." : "Otomatik Yerleştir"}
              </Button>
            </div>
          )}

          {/* Search Box - Daha kompakt */}
          <div className="mb-2">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                <Search className="h-3 w-3 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-6 pr-6 py-1 text-xs border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-2 flex items-center"
                >
                  <X className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
          </div>

          {/* Lessons List - Daha kompakt */}
          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
            {filteredUnassignedLessons.length > 0 ? (
              filteredUnassignedLessons.map((lesson, index) => {
                const isSelected = selectedLesson?.teacherName === lesson.teacherName && 
                                  selectedLesson?.className === lesson.className && 
                                  selectedLesson?.subjectName === lesson.subjectName;
                
                return (
                  <div 
                    key={`${lesson.teacherId}-${lesson.subjectId}-${index}`} 
                    onClick={() => setSelectedLesson(lesson)} 
                    className={`p-1.5 rounded-lg cursor-pointer border text-xs transition-all ${
                      isSelected 
                        ? 'bg-blue-50 border-blue-500 shadow-sm' 
                        : 'bg-white border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded-md mb-1 bg-blue-50 text-blue-700">
                          {lesson.subjectName}
                        </div>
                        <p className="font-medium text-gray-800 text-xs">{lesson.className}</p>
                        <p className="text-xs text-gray-600">{lesson.teacherName}</p>
                      </div>
                      <div className={`flex items-center justify-center w-4 h-4 rounded-full ${
                        lesson.missingHours > 0 
                          ? 'bg-red-100 text-red-600 border border-red-200' 
                          : 'bg-green-100 text-green-600 border border-green-200'
                      }`}>
                        {lesson.missingHours > 0 
                          ? <span className="text-xs font-bold">{lesson.missingHours}</span>
                          : <CheckCircle className="w-2 h-2" />
                        }
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center mb-2">
                  <Info className="w-4 h-4 text-gray-400" />
                </div>
                <p className="text-gray-500 text-xs">Sonuç bulunamadı</p>
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                  >
                    Aramayı Temizle
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Content Area - Daha kompakt */}
        <div className="lg:col-span-3 bg-white rounded-lg shadow-sm border border-gray-200 p-2 flex flex-col overflow-y-auto">
          {/* View Mode Tabs - Daha kompakt */}
          <div className="border-b border-gray-200 mb-2 flex-shrink-0">
            <nav className="-mb-px flex space-x-4">
              <button 
                onClick={() => setViewMode('focus')} 
                className={`py-1 px-1 border-b-2 font-medium text-xs flex items-center ${
                  viewMode === 'focus' 
                    ? 'border-blue-500 text-blue-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Eye className="w-3 h-3 mr-1" /> Odaklanmış Analiz
              </button>
              <button 
                onClick={() => setViewMode('overview')} 
                className={`py-1 px-1 border-b-2 font-medium text-xs flex items-center ${
                  viewMode === 'overview' 
                    ? 'border-blue-500 text-blue-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <LayoutGrid className="w-3 h-3 mr-1" /> Okul Geneli Görünüm
              </button>
            </nav>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {viewMode === 'focus' && (
              selectedLesson ? (
                <ScheduleComparisonView
                  selectedLesson={selectedLesson}
                  workingSchedules={workingSchedules}
                  onSlotAssign={handleSlotAssign}
                  onSwapRequest={handleSwapRequest}
                  teachers={teachers}
                  classes={classes}
                  subjects={subjects}
                  constraints={constraints}
                />
              ) : (
                <div className="text-center h-full flex flex-col justify-center items-center p-4">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <BrainCircuit className="w-6 h-6 text-gray-400" />
                  </div>
                  <h3 className="text-base font-medium text-gray-700 mb-2">Başlamak için bir ders seçin</h3>
                  <p className="text-gray-500 text-xs max-w-md">
                    Soldaki listeden bir derse tıklayarak hem sınıfın hem de öğretmenin programını aynı anda görüntüleyin.
                  </p>
                </div>
              )
            )}
            {viewMode === 'overview' && (
              <FullSchoolView 
                workingSchedules={workingSchedules}
                setWorkingSchedules={setWorkingSchedules}
                teachers={teachers}
                classes={classes}
                subjects={subjects}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleCompletionPage;
// --- END OF FILE src/pages/ScheduleCompletionPage.tsx ---