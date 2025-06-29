// --- START OF FILE src/pages/ScheduleCompletionPage.tsx (TAM VE SON HALİ) ---

import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrainCircuit, CheckCircle, Hourglass, ListTodo, Save, Eye, LayoutGrid } from 'lucide-react';
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

  const isLoading = loadingT || loadingC || loadingS || !allSchedules || !constraints;

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen">Veriler Yükleniyor...</div>;
  }
  
  if (!location.state?.unassignedLessons) {
    return (
      <div className="container-mobile text-center py-12">
        <h2 className="text-xl font-bold">Veri Bulunamadı</h2>
        <p className="text-gray-600 mt-2">Bu sayfaya doğrudan erişilemez. Lütfen sihirbazdan yönlendirmeyi kullanın.</p>
        <Button onClick={() => navigate('/schedule-wizard')} className="mt-4">Sihirbaza Geri Dön</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b p-4 flex items-center justify-between flex-wrap gap-4 sticky top-0 z-20">
        <div className="flex items-center"><BrainCircuit className="w-8 h-8 text-purple-600 mr-3" /><div><h1 className="text-xl font-bold text-gray-900">Yardımcı Atama Modülü</h1><p className="text-sm text-gray-600">{unassignedLessons.filter(l => l.missingHours > 0).length} dersin yerleşimi tamamlanacak</p></div></div>
        <div className="flex items-center space-x-2"><Button variant="secondary" onClick={() => navigate('/schedule-wizard')}>Sihirbaza Dön</Button><Button variant="primary" icon={Save} onClick={handleSaveAll} disabled={isSaving}>{isSaving ? "Kaydediliyor..." : "Değişiklikleri Kaydet ve Bitir"}</Button></div>
      </div>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 overflow-hidden">
        <div className="lg:col-span-1 bg-white rounded-lg shadow-sm border p-4 flex flex-col overflow-hidden">
          <h2 className="text-lg font-semibold mb-4 flex items-center flex-shrink-0"><ListTodo className="w-5 h-5 mr-2" />Yerleştirilecek Dersler</h2>
          <div className="flex-1 space-y-3 overflow-y-auto pr-2">
            {unassignedLessons.map((lesson, index) => {
                const isSelected = selectedLesson?.teacherName === lesson.teacherName && selectedLesson?.className === lesson.className && selectedLesson?.subjectName === lesson.subjectName;
                return (
                    <div key={`${lesson.teacherId}-${lesson.subjectId}-${index}`} onClick={() => setSelectedLesson(lesson)} className={`p-4 rounded-lg cursor-pointer border-2 transition-all ${isSelected ? 'bg-blue-50 border-blue-500 shadow-md' : 'bg-gray-50 border-gray-200 hover:border-blue-300'}`}>
                        <p className="font-bold text-gray-800">{lesson.subjectName}</p><p className="text-sm text-gray-600">{lesson.className} - {lesson.teacherName}</p>
                        <div className="mt-2 flex items-center justify-between text-xs">
                        <span className={`font-semibold flex items-center ${lesson.missingHours > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {lesson.missingHours > 0 ? <Hourglass className="w-3 h-3 mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                            {lesson.missingHours > 0 ? `${lesson.missingHours} saat eksik` : 'Tamamlandı'}
                        </span>
                        </div>
                    </div>
                )
            })}
          </div>
        </div>
        <div className="lg:col-span-3 bg-white rounded-lg shadow-sm border p-6 flex flex-col overflow-y-auto">
          <div className="border-b border-gray-200 mb-4 flex-shrink-0">
            <nav className="-mb-px flex space-x-6">
              <button onClick={() => setViewMode('focus')} className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${viewMode === 'focus' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Eye className="w-4 h-4 mr-2" /> Odaklanmış Analiz</button>
              <button onClick={() => setViewMode('overview')} className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${viewMode === 'overview' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><LayoutGrid className="w-4 h-4 mr-2" /> Okul Geneli Görünüm</button>
            </nav>
          </div>
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
              ) : ( <div className="text-center h-full flex flex-col justify-center items-center"><BrainCircuit className="w-24 h-24 text-gray-200 mb-4" /><h3 className="text-xl font-medium text-gray-700">Başlamak için bir ders seçin</h3><p className="text-gray-500 mt-2 max-w-md">Soldaki listeden bir derse tıklayarak hem sınıfın hem de öğretmenin programını aynı anda görüntüleyin ve çakışmayan boş saatleri kolayca bulun.</p></div> )
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