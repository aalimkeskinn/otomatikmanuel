// --- START OF FILE src/pages/ScheduleCompletionPage.tsx (TAM VE SON HALİ) ---

import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrainCircuit, CheckCircle, Hourglass, ListTodo, Save, Eye, LayoutGrid, ArrowLeft, Info, AlertCircle, Search, X } from 'lucide-react';
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
  const { success, error, info } = useToast();
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
      <div className="flex justify-center items-center h-screen bg-ide-primary-50">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-t-ide-primary-600 border-b-ide-primary-600 border-l-gray-200 border-r-gray-200 rounded-full animate-spin"></div>
          <h2 className="text-xl font-semibold text-ide-primary-800">Veriler Yükleniyor</h2>
          <p className="text-ide-primary-600 mt-2">Lütfen bekleyin...</p>
        </div>
      </div>
    );
  }
  
  if (!location.state?.unassignedLessons) {
    return (
      <div className="min-h-screen bg-ide-primary-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-8 text-center border border-ide-primary-100">
          <div className="w-16 h-16 bg-ide-primary-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="h-8 w-8 text-ide-primary-600" />
          </div>
          <h2 className="text-2xl font-bold text-ide-primary-900 mb-3">Veri Bulunamadı</h2>
          <p className="text-ide-primary-700 mb-6">Bu sayfaya doğrudan erişilemez. Lütfen sihirbazdan yönlendirmeyi kullanın.</p>
          <Button 
            onClick={() => navigate('/schedule-wizard')} 
            variant="ide-primary" 
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
    <div className="flex flex-col h-screen bg-ide-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b p-4 flex items-center justify-between flex-wrap gap-4 sticky top-0 z-20">
        <div className="flex items-center">
          <div className="w-12 h-12 bg-ide-primary-100 rounded-xl flex items-center justify-center mr-4 shadow-sm border border-ide-primary-200">
            <BrainCircuit className="w-7 h-7 text-ide-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ide-primary-900">Yardımcı Atama Modülü</h1>
            <p className="text-sm text-ide-primary-600">
              {unassignedLessons.filter(l => l.missingHours > 0).length} dersin yerleşimi tamamlanacak
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <Button 
            variant="secondary" 
            onClick={() => navigate('/schedule-wizard')}
            icon={ArrowLeft}
            className="border-2 border-ide-gray-200 hover:border-ide-primary-200"
          >
            Sihirbaza Dön
          </Button>
          <Button 
            variant="ide-primary" 
            icon={Save} 
            onClick={handleSaveAll} 
            disabled={isSaving}
            className="shadow-md hover:shadow-lg"
          >
            {isSaving ? "Kaydediliyor..." : "Değişiklikleri Kaydet ve Bitir"}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 overflow-hidden">
        {/* Left Sidebar - Unassigned Lessons */}
        <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-ide-gray-200 p-5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center text-ide-primary-900">
              <ListTodo className="w-5 h-5 mr-2 text-ide-primary-600" />
              Yerleştirilecek Dersler
            </h2>
            <span className="bg-ide-primary-100 text-ide-primary-800 text-xs font-semibold px-2.5 py-1 rounded-full border border-ide-primary-200">
              {filteredUnassignedLessons.length} ders
            </span>
          </div>

          {/* Search Box */}
          <div className="mb-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-ide-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Ders, sınıf veya öğretmen ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-2 border-2 border-ide-gray-200 rounded-lg focus:ring-2 focus:ring-ide-primary-500 focus:border-ide-primary-500 text-ide-gray-700"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <X className="h-5 w-5 text-ide-gray-400 hover:text-ide-gray-600" />
                </button>
              )}
            </div>
          </div>

          {/* Lessons List */}
          <div className="flex-1 space-y-3 overflow-y-auto pr-2">
            {filteredUnassignedLessons.length > 0 ? (
              filteredUnassignedLessons.map((lesson, index) => {
                const isSelected = selectedLesson?.teacherName === lesson.teacherName && 
                                  selectedLesson?.className === lesson.className && 
                                  selectedLesson?.subjectName === lesson.subjectName;
                
                // Renk hesaplama
                const getSubjectColor = (subjectName: string) => {
                  const colors = [
                    'bg-ide-primary-50 border-ide-primary-200 text-ide-primary-800',
                    'bg-ide-secondary-50 border-ide-secondary-200 text-ide-secondary-800',
                    'bg-purple-50 border-purple-200 text-purple-800',
                    'bg-blue-50 border-blue-200 text-blue-800',
                    'bg-indigo-50 border-indigo-200 text-indigo-800'
                  ];
                  
                  // Basit bir hash fonksiyonu
                  let hash = 0;
                  for (let i = 0; i < subjectName.length; i++) {
                    hash = subjectName.charCodeAt(i) + ((hash << 5) - hash);
                  }
                  
                  return colors[Math.abs(hash) % colors.length];
                };
                
                const colorClass = getSubjectColor(lesson.subjectName);
                
                return (
                  <div 
                    key={`${lesson.teacherId}-${lesson.subjectId}-${index}`} 
                    onClick={() => setSelectedLesson(lesson)} 
                    className={`p-4 rounded-xl cursor-pointer border-2 transition-all ${
                      isSelected 
                        ? 'bg-ide-primary-50 border-ide-primary-500 shadow-md transform scale-[1.02]' 
                        : 'bg-white border-ide-gray-200 hover:border-ide-primary-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full mb-2 ${colorClass}`}>
                          {lesson.subjectName}
                        </div>
                        <p className="font-bold text-ide-gray-800">{lesson.className}</p>
                        <p className="text-sm text-ide-gray-600">{lesson.teacherName}</p>
                      </div>
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                        lesson.missingHours > 0 
                          ? 'bg-ide-accent-100 text-ide-accent-600 border border-ide-accent-200' 
                          : 'bg-ide-secondary-100 text-ide-secondary-600 border border-ide-secondary-200'
                      }`}>
                        {lesson.missingHours > 0 
                          ? <span className="text-xs font-bold">{lesson.missingHours}</span>
                          : <CheckCircle className="w-4 h-4" />
                        }
                      </div>
                    </div>
                    
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className={`font-semibold flex items-center ${
                        lesson.missingHours > 0 ? 'text-ide-accent-600' : 'text-ide-secondary-600'
                      }`}>
                        {lesson.missingHours > 0 
                          ? <><Hourglass className="w-3 h-3 mr-1" /> {lesson.missingHours} saat eksik</> 
                          : <><CheckCircle className="w-4 h-4 mr-1" /> Tamamlandı</>
                        }
                      </span>
                      <span className="text-ide-gray-500">
                        {lesson.totalHours} saat/hafta
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <div className="w-12 h-12 bg-ide-gray-100 rounded-full flex items-center justify-center mb-3">
                  <Info className="w-6 h-6 text-ide-gray-400" />
                </div>
                <p className="text-ide-gray-500 font-medium">Arama sonucu bulunamadı</p>
                <p className="text-xs text-ide-gray-400 mt-1">Farklı bir arama terimi deneyin</p>
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="mt-3 text-sm text-ide-primary-600 hover:text-ide-primary-800 font-medium"
                  >
                    Aramayı Temizle
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Content Area */}
        <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-ide-gray-200 p-6 flex flex-col overflow-y-auto">
          {/* View Mode Tabs */}
          <div className="border-b border-ide-gray-200 mb-4 flex-shrink-0">
            <nav className="-mb-px flex space-x-6">
              <button 
                onClick={() => setViewMode('focus')} 
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                  viewMode === 'focus' 
                    ? 'border-ide-primary-500 text-ide-primary-600' 
                    : 'border-transparent text-ide-gray-500 hover:text-ide-gray-700 hover:border-ide-gray-300'
                }`}
              >
                <Eye className="w-4 h-4 mr-2" /> Odaklanmış Analiz
              </button>
              <button 
                onClick={() => setViewMode('overview')} 
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                  viewMode === 'overview' 
                    ? 'border-ide-primary-500 text-ide-primary-600' 
                    : 'border-transparent text-ide-gray-500 hover:text-ide-gray-700 hover:border-ide-gray-300'
                }`}
              >
                <LayoutGrid className="w-4 h-4 mr-2" /> Okul Geneli Görünüm
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
                <div className="text-center h-full flex flex-col justify-center items-center p-8">
                  <div className="w-24 h-24 bg-ide-primary-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
                    <BrainCircuit className="w-12 h-12 text-ide-primary-500" />
                  </div>
                  <h3 className="text-xl font-medium text-ide-primary-900 mb-3">Başlamak için bir ders seçin</h3>
                  <p className="text-ide-gray-600 max-w-md">
                    Soldaki listeden bir derse tıklayarak hem sınıfın hem de öğretmenin programını aynı anda görüntüleyin ve çakışmayan boş saatleri kolayca bulun.
                  </p>
                  <div className="mt-6 p-4 bg-ide-primary-50 border border-ide-primary-200 rounded-lg max-w-md">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-ide-primary-500" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-ide-primary-700">
                          <span className="font-semibold">İpucu:</span> Yeşil renkli alanlar dersin yerleştirilebileceği uygun saatleri gösterir. Kırmızı alanlar ise çakışma olan saatleri gösterir.
                        </p>
                      </div>
                    </div>
                  </div>
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