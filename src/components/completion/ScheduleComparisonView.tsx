// --- START OF FILE src/components/completion/ScheduleComparisonView.tsx (TAM VE DOĞRU HALİ) ---

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Schedule, DAYS, PERIODS, getTimePeriods, formatTimeRange, Teacher, Class, Subject, TimeConstraint, ScheduleSlot } from '../../types';
import { UnassignedLesson } from '../../types/wizard';
import { analyzeUnassignedLesson, generateSwapSuggestions, SwapSuggestion } from '../../utils/scheduleAnalyzer';
import { Users, Building, AlertTriangle, Lightbulb, Repeat, ExternalLink, Lock, Clock, CheckCircle, X, Info } from 'lucide-react';
import Button from '../UI/Button';
import Modal from '../UI/Modal';
import SuggestionBox from './SuggestionBox';

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
    <div className="flex-1 min-w-[300px]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <div className="flex items-center space-x-2">
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-green-500 mr-1"></div>
            <span className="text-xs text-gray-600">Uygun</span>
          </div>
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-red-500 mr-1"></div>
            <span className="text-xs text-gray-600">Dolu</span>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="table-responsive">
          <table className="min-w-full border-collapse border border-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-1 border border-gray-300 w-16 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">Saat</th>
                {DAYS.map(day => (
                  <th key={day} className="p-1 border border-gray-300 font-medium text-gray-700">{day}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timePeriods.map(tp => {
                const isBreakOrFixed = tp.isBreak || schedule[DAYS[0]]?.[tp.period]?.isFixed;
                if (tp.isBreak) {
                  return (
                    <tr key={tp.period} className="bg-gray-50">
                      <td className="p-1 border border-gray-200 text-xs text-center font-medium bg-gray-100 text-gray-700 sticky left-0 z-10">
                        <div className="flex flex-col items-center">
                          <span className="text-xs">
                            {tp.period.includes('break') ? 'Teneffüs' : tp.period.includes('prep') ? 'Hazırlık' : 'Yemek'}
                          </span>
                        </div>
                      </td>
                      <td colSpan={5} className="p-1 border border-gray-200 text-center text-gray-400">
                        <Lock size={12} className="mx-auto" />
                      </td>
                    </tr>
                  );
                }
                
                return (
                  <tr key={tp.period} className="hover:bg-gray-50">
                    <td className="p-1 border border-gray-200 text-xs text-center font-medium bg-gray-50 text-gray-700 sticky left-0 z-10">
                      <div className="flex flex-col items-center">
                        <span>{`${tp.period}.`}</span>
                        <span className="text-xs text-gray-500">{tp.startTime}</span>
                      </div>
                    </td>
                    {DAYS.map(day => {
                      const slotKey = `${day}-${tp.period}`;
                      const slot = schedule[day]?.[tp.period];
                      const isAvailable = availableSlots.has(slotKey);
                      const conflict = conflictReasons.get(slotKey);
                      
                      let bgColor = 'bg-white hover:bg-gray-50';
                      let hoverBg = 'hover:bg-gray-50';
                      let cursor = 'cursor-pointer';
                      let titleText = conflict?.join('\n') || '';
                      let content: React.ReactNode = <div className="h-4"> </div>;

                      const handleClick = () => onSlotClick(day, tp.period, slot || null);

                      if (isAvailable) {
                        bgColor = 'bg-green-100';
                        hoverBg = 'hover:bg-green-200 hover:scale-105';
                        titleText = 'Bu boş saate dersi ata';
                        content = (
                          <div className="flex items-center justify-center">
                            <CheckCircle className="w-3 h-3 text-green-600" />
                          </div>
                        );
                      } else if (slot) {
                        bgColor = 'bg-red-50';
                        hoverBg = 'hover:bg-red-100 hover:scale-105';
                        const subject = allSubjects.find(s => s.id === slot.subjectId);
                        titleText = `Dolu: ${subject?.name || 'Bilinmeyen Ders'}. Detayları ve takas seçeneğini görmek için tıkla.`;
                        content = (
                          <div className="font-medium text-red-700 text-xs">
                            {subject?.name || 'Dolu'}
                          </div>
                        );
                      } else {
                        bgColor = 'bg-gray-50';
                        hoverBg = 'hover:bg-gray-100';
                        if(conflict) {
                          content = <Lock size={12} className="mx-auto text-gray-400" />;
                          titleText = conflict.join('\n');
                        }
                      }

                      return (
                        <td 
                          key={slotKey} 
                          title={titleText}
                          className={`p-1 border border-gray-200 text-center transition-all ${bgColor} ${hoverBg} ${cursor}`} 
                          onClick={handleClick}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

const ScheduleComparisonView: React.FC<ScheduleComparisonViewProps> = ({ 
  selectedLesson, 
  workingSchedules, 
  onSlotAssign, 
  onSwapRequest, 
  teachers, 
  classes, 
  subjects, 
  constraints 
}) => {
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
    return (
      <div className="text-center p-4 bg-red-50 rounded-lg border border-red-200">
        <div className="w-10 h-10 mx-auto mb-2 bg-red-100 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-red-600" />
        </div>
        <h3 className="text-sm font-medium text-red-800 mb-1">Veri Hatası</h3>
        <p className="text-xs text-red-700">Öğretmen veya sınıf verisi bulunamadı. Lütfen verilerinizi kontrol edin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
        <h3 className="text-base font-semibold text-blue-900 mb-1">{selectedLesson.subjectName}</h3>
        <div className="flex flex-wrap items-center gap-1 text-xs text-blue-800">
          <div className="flex items-center">
            <Building className="w-3 h-3 mr-1 text-blue-700" />
            <strong>{selectedLesson.className}</strong>
          </div>
          <span className="text-blue-400">•</span>
          <div className="flex items-center">
            <Users className="w-3 h-3 mr-1 text-blue-700" />
            <strong>{selectedLesson.teacherName}</strong>
          </div>
          <span className="text-blue-400">•</span>
          <div className="flex items-center">
            <Clock className="w-3 h-3 mr-1 text-blue-700" />
            <span>
              <strong className="text-red-600">{selectedLesson.missingHours}</strong>/{selectedLesson.totalHours} saat
            </span>
          </div>
        </div>
      </div>
      
      {availableSlots.size === 0 && (
        <SuggestionBox suggestions={swapSuggestions} />
      )}
      
      <div className="p-2 bg-blue-50 border-l-3 border-blue-500 rounded-r-lg">
        <div className="flex">
          <div className="flex-shrink-0">
            <Info className="h-4 w-4 text-blue-600" />
          </div>
          <div className="ml-2">
            <p className="text-xs text-blue-800">
              <strong className="font-semibold">İpucu:</strong> Yeşil alanlara tıklayarak dersi atayın. Kırmızı alanlara tıklayarak çakışma nedenini görün veya takas işlemi başlatın.
            </p>
          </div>
        </div>
      </div>
      
      <div className="flex flex-col xl:flex-row gap-3">
        <SingleScheduleGrid 
          title={`${selectedLesson.className} Programı`} 
          schedule={classSchedule} 
          availableSlots={availableSlots} 
          conflictReasons={conflictReasons} 
          onSlotClick={handleSlotClick} 
          entityLevel={classItem.level} 
          allSubjects={subjects} 
        />
        <SingleScheduleGrid 
          title={`${selectedLesson.teacherName} Programı`} 
          schedule={teacherSchedule} 
          availableSlots={availableSlots} 
          conflictReasons={conflictReasons} 
          onSlotClick={handleSlotClick} 
          entityLevel={teacher.level} 
          allSubjects={subjects}
        />
      </div>

      {conflictModal.isOpen && (
        <Modal 
          isOpen={conflictModal.isOpen} 
          onClose={() => setConflictModal({isOpen: false, day: '', period: ''})} 
          title={`${conflictModal.day} - ${conflictModal.period}. Saat Çakışma Analizi`}
          size="md"
        >
          <div className="space-y-3">
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-medium text-red-800 mb-2 flex items-center text-sm">
                <AlertTriangle className="w-4 h-4 mr-1 text-red-600" />
                Bu Zaman Dilimi Neden Uygun Değil?
              </h4>
              <ul className="list-disc list-inside space-y-1 text-xs">
                {conflictReasons.get(`${conflictModal.day}-${conflictModal.period}`)?.map((reason, i) => (
                  <li key={i} className="p-1.5 bg-white text-red-800 rounded-md border border-red-100">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="pt-3 border-t border-gray-200">
              <h4 className="font-medium text-gray-800 mb-2 flex items-center text-sm">
                <Lightbulb className="w-4 h-4 mr-1 text-yellow-600" />
                Çözüm Yolları
              </h4>
              <p className="text-xs text-gray-600 mb-3">
                Bu çakışmayı çözmek için, çakışmaya neden olan dersi veya kısıtlamayı manuel olarak değiştirmeniz gerekebilir.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button 
                  variant="secondary" 
                  icon={ExternalLink} 
                  onClick={() => navigate(`/schedules?mode=teacher&teacherId=${selectedLesson.teacherId}`)}
                  size="sm"
                >
                  Öğretmen Programı
                </Button>
                <Button 
                  variant="secondary" 
                  icon={ExternalLink} 
                  onClick={() => navigate(`/schedules?mode=class&classId=${selectedLesson.classId}`)}
                  size="sm"
                >
                  Sınıf Programı
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