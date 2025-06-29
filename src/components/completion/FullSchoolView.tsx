// --- START OF FILE src/components/completion/FullSchoolView.tsx (TAM VE DOĞRU HALİ) ---

import React, { useMemo, useState } from 'react';
import { Schedule, Teacher, Class, Subject, DAYS, getTimePeriods, formatTimeRange, PERIODS, ScheduleSlot, EDUCATION_LEVELS } from '../../types';
import { stringToHslColor } from '../../utils/colorUtils';
import { GraduationCap, Lock, ArrowsUpDown, Info, Filter, Search, X } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import Select from '../UI/Select';

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
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const groupedClasses = useMemo(() => {
    // Önce sınıfları filtrele
    const filteredClasses = classes.filter(c => {
      if (selectedLevel && !(c.levels || [c.level]).includes(selectedLevel as any)) {
        return false;
      }
      
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(lowerQuery);
      }
      
      return true;
    });
    
    // Sonra seviyelere göre grupla
    const groups: { [key: string]: Class[] } = {};
    EDUCATION_LEVELS.forEach(level => {
      const levelClasses = filteredClasses
        .filter(c => (c.levels || [c.level]).includes(level))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      if (levelClasses.length > 0) {
        groups[level] = levelClasses;
      }
    });
    return groups;
  }, [classes, selectedLevel, searchQuery]);

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
      <div className="p-5 bg-white border rounded-xl mb-6 shadow-sm">
        <h3 className="font-semibold text-gray-800 text-lg mb-3">Okul Geneli Operasyon Masası</h3>
        <p className="text-sm text-gray-600 mb-4">
          Dersleri sürükleyip boş bir alana taşıyabilir veya başka bir dersle yerlerini değiştirebilirsiniz (takas).
        </p>
        
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="flex-1">
            <Select 
              label="Seviye Filtresi" 
              value={selectedLevel} 
              onChange={setSelectedLevel} 
              options={[
                { value: '', label: 'Tüm Seviyeler' },
                ...EDUCATION_LEVELS.map(level => ({ value: level, label: level }))
              ]} 
            />
          </div>
          
          <div className="flex-1">
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Sınıf Ara
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Sınıf adı ara..."
                className="block w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <X className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Info className="h-5 w-5 text-blue-600 mt-0.5" />
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-blue-800">Sürükle & Bırak Kullanımı</h4>
              <p className="text-sm text-blue-700 mt-1">
                Dersleri sürükleyip bırakarak taşıyabilir veya iki dersin yerini değiştirebilirsiniz. Boş bir alana bırakırsanız ders taşınır, dolu bir alana bırakırsanız dersler yer değiştirir.
              </p>
              <div className="mt-2 flex items-center">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  <ArrowsUpDown className="w-3 h-3 mr-1" /> Sürükle & Bırak
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="space-y-12">
        {Object.keys(groupedClasses).length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <Filter className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Sınıf Bulunamadı</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              {searchQuery 
                ? `"${searchQuery}" aramasına uygun sınıf bulunamadı.` 
                : selectedLevel 
                  ? `${selectedLevel} seviyesinde sınıf bulunamadı.` 
                  : 'Görüntülenecek sınıf bulunamadı.'}
            </p>
            {(searchQuery || selectedLevel) && (
              <button 
                onClick={() => {setSearchQuery(''); setSelectedLevel('');}}
                className="mt-4 text-sm font-medium text-purple-600 hover:text-purple-800"
              >
                Filtreleri Temizle
              </button>
            )}
          </div>
        ) : (
          Object.entries(groupedClasses).map(([level, classesInLevel]) => {
            const timePeriods = getTimePeriods(level as any);
            return (
              <div key={level} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center p-4 bg-gradient-to-r from-purple-50 to-purple-100 border-b border-purple-200">
                  <GraduationCap className="w-6 h-6 mr-3 text-purple-600" />
                  <h3 className="text-xl font-bold text-purple-900">{level} Programları</h3>
                  <span className="ml-3 bg-purple-200 text-purple-800 text-xs font-semibold px-2.5 py-1 rounded-full">
                    {classesInLevel.length} sınıf
                  </span>
                </div>
                
                <div className="table-responsive p-4" style={{ maxHeight: '80vh' }}>
                  <table className="min-w-full text-xs border-collapse">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-2 border border-gray-300 sticky top-0 left-0 bg-gray-200 z-20 w-24">Gün/Saat</th>
                        {classesInLevel.map(c => (
                          <th key={c.id} className="p-2 border border-gray-300 sticky top-0 bg-gray-100 z-10 whitespace-nowrap">
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DAYS.map(day => (
                        <React.Fragment key={day}>
                          <tr>
                            <td colSpan={classesInLevel.length + 1} className="p-2 font-bold text-center bg-gray-200 border-t-2 border-gray-400">
                              {day}
                            </td>
                          </tr>
                          {timePeriods.map(tp => {
                            if (tp.isBreak) return null;
                            return (
                              <tr key={`${day}-${tp.period}`} className="hover:bg-gray-50">
                                <td className="p-2 border border-gray-200 font-semibold sticky left-0 z-10 text-center bg-gray-100">
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
                                  const subject = slot?.subjectId ? subjects.find(s => s.id === slot?.subjectId) : null;
                                  const cellData: CellData = { classId: c.id, day: day, period: tp.period, slot };
                                  const isDragging = draggingCell?.classId === c.id && draggingCell?.day === day && draggingCell?.period === tp.period;
                                  
                                  const cellStyle: React.CSSProperties = {};
                                  let title = `${c.name} - ${day} ${tp.period}. Ders`;
                                  let content: React.ReactNode = <div className="h-5"> </div>;

                                  if (teacher && subject) {
                                    cellStyle.backgroundColor = stringToHslColor(teacher.branch, 65, 88);
                                    cellStyle.cursor = 'grab';
                                    title = `${teacher.name} - ${subject.name}`;
                                    content = (
                                      <div className="text-center">
                                        <div className="font-semibold text-xs truncate">{teacher.name.split(' ').pop()}</div>
                                        <div className="text-xs opacity-80 truncate">{subject.name}</div>
                                      </div>
                                    );
                                  }
                                  
                                  return (
                                    <td 
                                      key={`${c.id}-${day}-${tp.period}`} 
                                      className={`p-2 border border-gray-200 text-center transition-all ${
                                        isDragging 
                                          ? 'shadow-2xl scale-110 z-20 opacity-75' 
                                          : 'hover:shadow-md'
                                      }`}
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
          })
        )}
      </div>
    </div>
  );
};

export default FullSchoolView;
// --- END OF FILE src/components/completion/FullSchoolView.tsx ---