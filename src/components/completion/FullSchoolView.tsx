// --- START OF FILE src/components/completion/FullSchoolView.tsx (TAM VE DOĞRU HALİ) ---

import React, { useMemo, useState } from 'react';
import { Schedule, Teacher, Class, Subject, DAYS, getTimePeriods, formatTimeRange, PERIODS, ScheduleSlot, EDUCATION_LEVELS } from '../../types';
import { stringToHslColor } from '../../utils/colorUtils';
import { GraduationCap, Lock } from 'lucide-react';
import { useToast } from '../../hooks/useToast';

interface FullSchoolViewProps {
  workingSchedules: Schedule[];
  setWorkingSchedules: React.Dispatch<React.SetStateAction<Schedule[]>>;
  teachers: Teacher[];
  classes: Class[];
  subjects: Subject[];
}

interface CellData {
  classId: string;
  day: string;
  period: string;
  slot: ScheduleSlot | null;
}

const FullSchoolView: React.FC<FullSchoolViewProps> = ({ workingSchedules, setWorkingSchedules, teachers, classes, subjects }) => {
  const { info, error } = useToast();
  const [draggingCell, setDraggingCell] = useState<CellData | null>(null);

  const groupedClasses = useMemo(() => {
    const groups: { [key: string]: Class[] } = {};
    EDUCATION_LEVELS.forEach(level => {
      const levelClasses = classes
        .filter(c => (c.levels || [c.level]).includes(level))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      if (levelClasses.length > 0) {
        groups[level] = levelClasses;
      }
    });
    return groups;
  }, [classes]);

  const handleDragStart = (cellData: CellData) => {
    if (!cellData.slot) return;
    setDraggingCell(cellData);
  };

  const handleDrop = (targetCell: CellData) => {
    if (!draggingCell) return;
    
    // Aynı hücreye bırakılıyorsa işlem yapma
    if (draggingCell.classId === targetCell.classId && 
        draggingCell.day === targetCell.day && 
        draggingCell.period === targetCell.period) {
      setDraggingCell(null);
      return;
    }
    
    // Kaynak ve hedef slotları belirle
    const sourceSlot = draggingCell.slot;
    const targetSlot = targetCell.slot;
    
    if (!sourceSlot || !sourceSlot.teacherId) {
      setDraggingCell(null);
      return;
    }
    
    setWorkingSchedules(prevSchedules => {
      const newSchedules = JSON.parse(JSON.stringify(prevSchedules));
      
      // Kaynak öğretmenin programını bul
      const sourceTeacherSchedule = newSchedules.find((s: Schedule) => s.teacherId === sourceSlot.teacherId);
      if (!sourceTeacherSchedule) {
        error("Öğretmen programı bulunamadı", "Sürüklenen dersin öğretmen programı bulunamadı.");
        return prevSchedules;
      }
      
      // Hedef hücrede bir ders varsa (takas işlemi)
      if (targetSlot && targetSlot.teacherId) {
        // Hedef öğretmenin programını bul
        const targetTeacherSchedule = newSchedules.find((s: Schedule) => s.teacherId === targetSlot.teacherId);
        if (!targetTeacherSchedule) {
          error("Hedef öğretmen programı bulunamadı", "Takas yapılacak dersin öğretmen programı bulunamadı.");
          return prevSchedules;
        }
        
        // Takas işlemi - Kaynak dersi hedef konuma taşı
        targetTeacherSchedule.schedule[targetCell.day][targetCell.period] = {
          classId: draggingCell.classId,
          subjectId: sourceSlot.subjectId
        };
        
        // Hedef dersi kaynak konuma taşı
        sourceTeacherSchedule.schedule[draggingCell.day][draggingCell.period] = {
          classId: targetCell.classId,
          subjectId: targetSlot.subjectId
        };
        
        info("Dersler Takas Edildi", `${draggingCell.day} ${draggingCell.period}. saat ile ${targetCell.day} ${targetCell.period}. saat arasında takas yapıldı.`);
      } 
      // Hedef hücre boşsa (taşıma işlemi)
      else {
        // Kaynak dersi hedef konuma taşı
        sourceTeacherSchedule.schedule[targetCell.day][targetCell.period] = {
          classId: targetCell.classId,
          subjectId: sourceSlot.subjectId
        };
        
        // Kaynak konumu boşalt
        sourceTeacherSchedule.schedule[draggingCell.day][draggingCell.period] = null;
        
        info("Ders Taşındı", `Ders ${draggingCell.day} ${draggingCell.period}. saatten ${targetCell.day} ${targetCell.period}. saate taşındı.`);
      }
      
      return newSchedules;
    });
    
    setDraggingCell(null);
  };

  return (
    <div>
      <div className="p-4 bg-gray-50 border rounded-lg mb-6">
        <h3 className="font-semibold text-gray-800">Okul Geneli Operasyon Masası</h3>
        <p className="text-sm text-gray-600 mt-1">
          Dersleri sürükleyip boş bir alana taşıyabilir veya başka bir dersle yerlerini değiştirebilirsiniz (takas).
        </p>
      </div>
      <div className="space-y-12">
        {(Object.keys(groupedClasses) as Array<keyof typeof groupedClasses>).map(level => {
          const classesInLevel = groupedClasses[level];
          const timePeriods = getTimePeriods(level);
          return (
            <div key={level}>
              <div className="flex items-center mb-4 pb-2 border-b-2 border-ide-primary">
                <GraduationCap className="w-6 h-6 mr-3 text-ide-primary" />
                <h3 className="text-xl font-bold text-ide-primary-dark">{level} Programları</h3>
              </div>
              <div className="table-responsive" style={{ maxHeight: '80vh' }}>
                <table className="min-w-full text-xs border-collapse">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="p-1 border border-gray-300 sticky top-0 left-0 bg-gray-200 z-20 w-24">Gün/Saat</th>
                      {classesInLevel.map(c => <th key={c.id} className="p-1 border border-gray-300 sticky top-0 bg-gray-100 z-10 whitespace-nowrap">{c.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map(day => (
                      <React.Fragment key={day}>
                        <tr><td colSpan={classesInLevel.length + 1} className="p-1 font-bold text-center bg-gray-200 border-t-2 border-gray-400">{day}</td></tr>
                        {timePeriods.map(tp => {
                          if (tp.isBreak) return null;
                          return (
                            <tr key={`${day}-${tp.period}`}>
                              <td className="p-1 border border-gray-200 font-semibold sticky left-0 z-10 text-center bg-gray-100">
                                {tp.period}. <span className="font-normal text-gray-500">({tp.startTime})</span>
                              </td>
                              {classesInLevel.map(c => {
                                let slot: ScheduleSlot | null = null;
                                for (const s of workingSchedules) {
                                  if (s.schedule[day]?.[tp.period]?.classId === c.id) {
                                    slot = { ...s.schedule[day][tp.period], teacherId: s.teacherId };
                                    break;
                                  }
                                }
                                const teacher = slot?.teacherId ? teachers.find(t => t.id === slot.teacherId) : null;
                                const cellData: CellData = { classId: c.id, day: day, period: tp.period, slot };
                                const isDragging = draggingCell?.classId === c.id && draggingCell?.day === day && draggingCell?.period === tp.period;
                                
                                const cellStyle: React.CSSProperties = {};
                                let title = `${c.name} - ${day} ${tp.period}. Ders`;
                                let content: React.ReactNode = <div className="h-4"> </div>;

                                if (teacher) {
                                  cellStyle.backgroundColor = stringToHslColor(teacher.branch, 65, 88);
                                  cellStyle.cursor = 'grab';
                                  const subject = subjects.find(s => s.id === slot?.subjectId);
                                  title = `${teacher.name} - ${subject?.name || teacher.branch}`;
                                  content = <>{teacher.name.split(' ').pop()}</>;
                                }
                                
                                return (
                                  <td 
                                    key={`${c.id}-${day}-${tp.period}`} 
                                    className={`p-1 border border-gray-200 text-center whitespace-nowrap transition-all ${isDragging ? 'shadow-2xl scale-110 z-20 opacity-75' : 'hover:shadow-md'}`}
                                    style={cellStyle}
                                    title={title}
                                    draggable={!!slot}
                                    onDragStart={() => handleDragStart(cellData)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => handleDrop(cellData)}
                                    onDragEnd={() => setDraggingCell(null)}
                                  >
                                    {content}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FullSchoolView;
// --- END OF FILE src/components/completion/FullSchoolView.tsx ---