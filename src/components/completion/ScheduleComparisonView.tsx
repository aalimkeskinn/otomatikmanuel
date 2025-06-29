// --- START OF FILE src/components/completion/ScheduleComparisonView.tsx (TAM VE EKSİKSİZ HALİ) ---

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Schedule, DAYS, PERIODS, getTimePeriods, formatTimeRange, Teacher, Class, Subject, TimeConstraint, ScheduleSlot } from '../../types';
import { UnassignedLesson } from '../../types/wizard';
import { analyzeUnassignedLesson, generateSwapSuggestions, SwapSuggestion } from '../../utils/scheduleAnalyzer';
import { Users, Building, AlertTriangle, Lightbulb, Repeat, ExternalLink, Lock } from 'lucide-react';
import Button from '../UI/Button';
import Modal from '../UI/Modal';

// Öneri kutusu için ayrı bir component
const SuggestionBox: React.FC<{
  suggestions: SwapSuggestion[];
}> = ({ suggestions }) => {
    const navigate = useNavigate();

    const handleSuggestionClick = (suggestion: SwapSuggestion) => {
        alert(`Öneri: ${suggestion.targetClass.name} sınıfının ${suggestion.day} ${suggestion.period}. saatindeki ${suggestion.targetSubject.name} dersini, yerleştirmeye çalıştığınız dersle takas etmeyi deneyin. Bu dersi manuel programdan boş bir saate taşıyarak bu alanı açabilirsiniz.`);
        navigate(`/schedules?mode=teacher&teacherId=${suggestion.targetTeacher.id}`);
    };

    if (suggestions.length === 0) {
        return (
            <div className="p-4 bg-gray-100 border rounded-lg mt-6 text-center">
                <h4 className="font-medium text-gray-700">Otomatik Öneri Bulunamadı</h4>
                <p className="text-sm text-gray-500 mt-1">Bu dersi yerleştirmek için uygun bir takas bulunamadı. Lütfen kısıtlamaları veya diğer derslerin yerlerini manuel olarak kontrol edin.</p>
            </div>
        );
    }

    return (
        <div className="p-4 bg-ide-primary-50 border-l-4 border-ide-primary-500 mt-6 rounded-r-lg">
            <div className="flex">
                <div className="flex-shrink-0"><Lightbulb className="h-5 w-5 text-ide-primary-600 mt-1" /></div>
                <div className="ml-3 w-full">
                    <h3 className="text-sm font-medium text-ide-primary-800">Çözüm Önerileri</h3>
                    <p className="text-xs text-ide-primary-700 mb-3">Aşağıdaki derslerden birini farklı bir saate taşıyarak yer açmayı deneyebilirsiniz:</p>
                    <div className="space-y-3">
                        {suggestions.map((s, index) => (
                        <div key={index} className="p-3 bg-white rounded-lg border border-ide-primary-200 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className='flex-1 text-sm'>
                                    <p>
                                        <strong className="text-red-600">{s.day} {s.period}. saatteki</strong>
                                    </p>
                                    <p className="font-semibold text-gray-800">
                                        <strong className="text-indigo-600">{s.targetSubject.name}</strong> dersini ({s.targetClass.name} sınıfı)
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        Öğretmen: {s.targetTeacher.name}
                                    </p>
                                </div>
                                <Button 
                                    size="sm"
                                    icon={Repeat}
                                    variant="secondary"
                                    onClick={() => handleSuggestionClick(s)}
                                    className="flex-shrink-0 ml-4"
                                >
                                    Dersi Taşı
                                </Button>
                            </div>
                        </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};


// Tek bir program tablosunu gösteren alt component
const SingleScheduleGrid: React.FC<{
  title: string;
  schedule: Schedule['schedule'];
  availableSlots: Set<string>;
  conflictReasons: Map<string, string[]>;
  onSlotClick: (day: string, period: string, currentSlot: ScheduleSlot | null) => void;
  entityLevel: 'Anaokulu' | 'İlkokul' | 'Ortaokul';
  allSubjects: Subject[];
}> = ({ title, schedule, availableSlots, conflictReasons, onSlotClick, entityLevel, allSubjects }) => {
  const timePeriods = getTimePeriods(entityLevel);
  if (!timePeriods) return null;

  return (
    <div className="flex-1 min-w-[400px]">
      <h3 className="text-lg font-semibold text-center mb-4 text-gray-800">{title}</h3>
      <div className="table-responsive">
        <table className="min-w-full border-collapse border border-gray-200">
          <thead className="bg-gray-100">
            <tr className="text-xs">
              <th className="p-1 border-b border-gray-300 w-24 font-semibold text-gray-600">Saat</th>
              {DAYS.map(day => <th key={day} className="p-1 border-b border-gray-300 font-semibold text-gray-600">{day}</th>)}
            </tr>
          </thead>
          <tbody>
            {timePeriods.map(tp => {
              const isBreakOrFixed = tp.isBreak || schedule[DAYS[0]]?.[tp.period]?.isFixed;
              if (tp.isBreak) {
                return (
                    <tr key={tp.period} className="bg-gray-100">
                        <td className="p-1 border border-gray-200 text-xs text-center font-medium bg-gray-200 text-gray-600">
                           {tp.period.includes('break') ? 'Teneffüs' : tp.period.includes('prep') ? 'Hazırlık' : 'Yemek'}
                           <br />
                           <span className="font-normal text-gray-500">{formatTimeRange(tp.startTime, tp.endTime)}</span>
                        </td>
                        <td colSpan={5} className="p-1 border border-gray-200 text-center text-gray-400">
                           <Lock size={14} className="mx-auto" />
                        </td>
                    </tr>
                );
              }
              
              return (
                <tr key={tp.period} className="hover:bg-gray-50">
                  <td className="p-1 border border-gray-200 text-xs text-center font-medium bg-gray-50">
                    {`${tp.period}.`} <br/>
                    <span className="font-normal text-gray-500">{formatTimeRange(tp.startTime, tp.endTime)}</span>
                  </td>
                  {DAYS.map(day => {
                    const slotKey = `${day}-${tp.period}`;
                    const slot = schedule[day]?.[tp.period];
                    const isAvailable = availableSlots.has(slotKey);
                    const conflict = conflictReasons.get(slotKey);
                    
                    let bgColor = 'bg-white';
                    let cursor = 'cursor-pointer';
                    let titleText = conflict?.join('\n') || '';
                    let content: React.ReactNode = <div className="h-4"> </div>;

                    const handleClick = () => onSlotClick(day, tp.period, slot || null);

                    if (isAvailable) {
                      bgColor = 'bg-green-100 hover:bg-green-200';
                      titleText = 'Bu boş saate dersi ata';
                    } else if (slot) {
                      bgColor = 'bg-red-50 hover:bg-red-100';
                      const subject = allSubjects.find(s => s.id === slot.subjectId);
                      titleText = `Dolu: ${subject?.name || 'Bilinmeyen Ders'}. Detayları ve takas seçeneğini görmek için tıkla.`;
                      content = <div className="font-semibold text-red-700">{subject?.name || 'Dolu'}</div>;
                    } else {
                        bgColor = 'bg-gray-100 hover:bg-gray-200';
                        if(conflict) {
                            content = <Lock size={14} className="mx-auto text-gray-400" />;
                        }
                    }

                    return (
                      <td 
                        key={slotKey} 
                        title={titleText}
                        className={`p-1 border border-gray-200 text-center text-xs transition-all duration-150 ${bgColor} ${cursor}`} 
                        onClick={handleClick}
                      >
                       {content}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};


interface ScheduleComparisonViewProps {
  selectedLesson: UnassignedLesson;
  workingSchedules: Schedule[];
  onSlotAssign: (day: string, period: string) => void;
  onSwapRequest: (day: string, period: string, conflictingSlot: ScheduleSlot) => void;
  teachers: Teacher[];
  classes: Class[];
  subjects: Subject[];
  constraints: TimeConstraint[];
}

const ScheduleComparisonView: React.FC<ScheduleComparisonViewProps> = ({ selectedLesson, workingSchedules, onSlotAssign, onSwapRequest, teachers, classes, subjects, constraints }) => {
    const navigate = useNavigate();
    const [conflictModal, setConflictModal] = useState<{isOpen: boolean, day: string, period: string}>({isOpen: false, day: '', period: ''});
    
    const teacher = teachers.find(t => t.id === selectedLesson.teacherId);
    const classItem = classes.find(c => c.id === selectedLesson.classId);
  
    const createEmptyScheduleGrid = (): Schedule['schedule'] => {
      const grid: Schedule['schedule'] = {};
      DAYS.forEach(day => {
        grid[day] = {};
        PERIODS.forEach(period => { grid[day][period] = null; });
      });
      return grid;
    };
    
    const { teacherSchedule, classSchedule } = useMemo(() => {
        const tSchedule = workingSchedules.find(s => s.teacherId === selectedLesson.teacherId)?.schedule || createEmptyScheduleGrid();
        const cSchedule: Schedule['schedule'] = createEmptyScheduleGrid();
        workingSchedules.forEach(s => {
          Object.entries(s.schedule).forEach(([day, daySlots]) => {
            if (daySlots) {
                Object.entries(daySlots).forEach(([period, slot]) => {
                    if (slot?.classId === selectedLesson.classId) {
                    cSchedule[day][period] = { ...slot, teacherId: s.teacherId };
                    }
                });
            }
          });
        });
        return { teacherSchedule: tSchedule, classSchedule: cSchedule };
      }, [selectedLesson, workingSchedules]);
  
    const { availableSlots, conflictReasons } = useMemo(() => {
      if (!selectedLesson || !teacher || !classItem) return { availableSlots: new Set(), conflictReasons: new Map() };
      return analyzeUnassignedLesson(selectedLesson, teacherSchedule, classSchedule, constraints, teachers, classes, subjects);
    }, [selectedLesson, teacherSchedule, classSchedule, constraints, teacher, classItem, teachers, classes, subjects]);
  
    const swapSuggestions = useMemo(() => {
      if (!selectedLesson || availableSlots.size > 0) return [];
      return generateSwapSuggestions(selectedLesson, workingSchedules, teachers, classes, subjects);
    }, [selectedLesson, availableSlots.size, workingSchedules, teachers, classes, subjects]);
  
    const handleSlotClick = (day: string, period: string, currentSlot: ScheduleSlot | null) => {
        if (!currentSlot) {
            onSlotAssign(day, period);
        } else {
            const conflict = conflictReasons.get(`${day}-${period}`);
            if (conflict && conflict.length > 0) {
                setConflictModal({ isOpen: true, day, period });
            } else {
                onSwapRequest(day, period, currentSlot);
            }
        }
    };
    
    if (!teacher || !classItem) {
      return <div className="text-center text-red-500 p-8">Öğretmen veya sınıf verisi bulunamadı. Lütfen verilerinizi kontrol edin.</div>;
    }
  
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">{selectedLesson.subjectName}</h3>
          <p className="text-gray-500 mt-1">
            <strong className="text-gray-700">{selectedLesson.className}</strong> sınıfı ve <strong className="text-gray-700">{selectedLesson.teacherName}</strong> için uygun yerleştirme alanlarını arayın.
          </p>
        </div>
        
        {availableSlots.size === 0 && (
          <SuggestionBox suggestions={swapSuggestions} />
        )}
        
        <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded-r-lg">
          <div className="flex"><div className="flex-shrink-0"><AlertTriangle className="h-5 w-5 text-yellow-500" /></div><div className="ml-3"><p className="text-sm text-yellow-800"><strong className="font-semibold">İpucu:</strong> Yeşil alanlara tıklayarak dersi atayın. Kırmızı alanlara tıklayarak çakışma nedenini görün veya takas işlemi başlatın.</p></div></div>
        </div>
        
        <div className="flex flex-col xl:flex-row gap-8">
          <SingleScheduleGrid title={`${selectedLesson.className} Programı`} schedule={classSchedule} availableSlots={availableSlots} conflictReasons={conflictReasons} onSlotClick={handleSlotClick} entityLevel={classItem.level} allSubjects={subjects} />
          <SingleScheduleGrid title={`${selectedLesson.teacherName} Programı`} schedule={teacherSchedule} availableSlots={availableSlots} conflictReasons={conflictReasons} onSlotClick={handleSlotClick} entityLevel={teacher.level} allSubjects={subjects}/>
        </div>
  
        {conflictModal.isOpen && (
          <Modal 
            isOpen={conflictModal.isOpen} 
            onClose={() => setConflictModal({isOpen: false, day: '', period: ''})} 
            title={`${conflictModal.day} - ${conflictModal.period}. Saat Çakışma Analizi`}
          >
              <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800">Bu Zaman Dilimi Neden Uygun Değil?</h4>
                  <ul className="list-disc list-inside space-y-2 text-sm">
                      {conflictReasons.get(`${conflictModal.day}-${conflictModal.period}`)?.map((reason, i) => (
                          <li key={i} className="p-2 bg-red-50 text-red-800 rounded-md">{reason}</li>
                      ))}
                  </ul>
                  <div className="pt-4 border-t">
                      <h4 className="font-semibold text-gray-800 mb-2">Çözüm Yolları</h4>
                      <p className="text-sm text-gray-600">
                          Bu çakışmayı çözmek için, çakışmaya neden olan dersi veya kısıtlamayı manuel olarak değiştirmeniz gerekebilir. Aşağıdaki butonları kullanarak ilgili düzenleme sayfalarına gidebilirsiniz.
                      </p>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Button variant="secondary" icon={ExternalLink} onClick={() => navigate(`/schedules?mode=teacher&teacherId=${selectedLesson.teacherId}`)}>
                              Öğretmen Programını Düzenle
                          </Button>
                          <Button variant="secondary" icon={ExternalLink} onClick={() => navigate(`/schedules?mode=class&classId=${selectedLesson.classId}`)}>
                             Sınıf Programını Düzenle
                          </Button>
                      </div>
                  </div>
              </div>
          </Modal>
        )}
      </div>
    );
  };
  
export default ScheduleComparisonView;

// --- END OF FILE src/components/completion/ScheduleComparisonView.tsx ---