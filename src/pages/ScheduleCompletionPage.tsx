// --- START OF FILE src/pages/ScheduleCompletionPage.tsx (TAM VE SON HALİ) ---

import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrainCircuit, CheckCircle, Hourglass, ListTodo, Save, Eye, LayoutGrid, ArrowLeft, Info, AlertCircle } from 'lucide-react';
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
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-t-blue-600 border-b-blue-600 border-l-gray-200 border-r-gray-200 rounded-full animate-spin"></div>
          <h2 className="text-xl font-semibold text-gray-700">Veriler Yükleniyor</h2>
          <p className="text-gray-500 mt-2">Lütfen bekleyin...</p>
        </div>
      </div>
    );
  }
  
  if (!location.state?.unassignedLessons) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Veri Bulunamadı</h2>
          <p className="text-gray-600 mb-6">Bu sayfaya doğrudan erişilemez. Lütfen sihirbazdan yönlendirmeyi kullanın.</p>
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
      {/* Header */}
      <div className="bg-white shadow-sm border-b p-4 flex items-center justify-between flex-wrap gap-4 sticky top-0 z-20">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
            <BrainCircuit className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Yardımcı Atama Modülü</h1>
            <p className="text-sm text-gray-600">
              {unassignedLessons.filter(l => l.missingHours > 0).length} dersin yerleşimi tamamlanacak
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <Button 
            variant="secondary" 
            onClick={() => navigate('/schedule-wizard')}
            icon={ArrowLeft}
          >
            Sihirbaza Dön
          </Button>
          <Button 
            variant="primary" 
            icon={Save} 
            onClick={handleSaveAll} 
            disabled={isSaving}
          >
            {isSaving ? "Kaydediliyor..." : "Değişiklikleri Kaydet ve Bitir"}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 overflow-hidden">
        {/* Left Sidebar - Unassigned Lessons */}
        <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border p-4 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center">
              <ListTodo className="w-5 h-5 mr-2 text-purple-600" />
              Yerleştirilecek Dersler
            </h2>
            <span className="bg-purple-100 text-purple-800 text-xs font-semibold px-2.5 py-1 rounded-full">
              {filteredUnassignedLessons.length} ders
            </span>
          </div>

          {/* Search Box */}
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Ders, sınıf veya öğretmen ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
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
                    'bg-blue-50 border-blue-300 text-blue-800',
                    'bg-green-50 border-green-300 text-green-800',
                    'bg-purple-50 border-purple-300 text-purple-800',
                    'bg-yellow-50 border-yellow-300 text-yellow-800',
                    'bg-pink-50 border-pink-300 text-pink-800',
                    'bg-indigo-50 border-indigo-300 text-indigo-800'
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
                        ? 'bg-purple-50 border-purple-500 shadow-md transform scale-[1.02]' 
                        : 'bg-white border-gray-200 hover:border-purple-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full mb-2 ${colorClass}`}>
                          {lesson.subjectName}
                        </div>
                        <p className="font-bold text-gray-800">{lesson.className}</p>
                        <p className="text-sm text-gray-600">{lesson.teacherName}</p>
                      </div>
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                        lesson.missingHours > 0 
                          ? 'bg-red-100 text-red-600' 
                          : 'bg-green-100 text-green-600'
                      }`}>
                        {lesson.missingHours > 0 
                          ? <span className="text-xs font-bold">{lesson.missingHours}</span>
                          : <CheckCircle className="w-4 h-4" />
                        }
                      </div>
                    </div>
                    
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className={`font-semibold flex items-center ${
                        lesson.missingHours > 0 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {lesson.missingHours > 0 
                          ? <><Hourglass className="w-3 h-3 mr-1" /> {lesson.missingHours} saat eksik</> 
                          : <><CheckCircle className="w-4 h-4 mr-1" /> Tamamlandı</>
                        }
                      </span>
                      <span className="text-gray-500">
                        {lesson.totalHours} saat/hafta
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                  <Info className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-gray-500 font-medium">Arama sonucu bulunamadı</p>
                <p className="text-xs text-gray-400 mt-1">Farklı bir arama terimi deneyin</p>
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="mt-3 text-sm text-purple-600 hover:text-purple-800 font-medium"
                  >
                    Aramayı Temizle
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Content Area */}
        <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border p-6 flex flex-col overflow-y-auto">
          {/* View Mode Tabs */}
          <div className="border-b border-gray-200 mb-4 flex-shrink-0">
            <nav className="-mb-px flex space-x-6">
              <button 
                onClick={() => setViewMode('focus')} 
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                  viewMode === 'focus' 
                    ? 'border-purple-500 text-purple-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Eye className="w-4 h-4 mr-2" /> Odaklanmış Analiz
              </button>
              <button 
                onClick={() => setViewMode('overview')} 
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                  viewMode === 'overview' 
                    ? 'border-purple-500 text-purple-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
                  <div className="w-24 h-24 bg-purple-100 rounded-full flex items-center justify-center mb-6">
                    <BrainCircuit className="w-12 h-12 text-purple-500" />
                  </div>
                  <h3 className="text-xl font-medium text-gray-700 mb-3">Başlamak için bir ders seçin</h3>
                  <p className="text-gray-500 max-w-md">
                    Soldaki listeden bir derse tıklayarak hem sınıfın hem de öğretmenin programını aynı anda görüntüleyin ve çakışmayan boş saatleri kolayca bulun.
                  </p>
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg max-w-md">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-blue-500" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-blue-700">
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