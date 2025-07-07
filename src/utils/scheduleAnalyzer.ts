// --- START OF FILE src/utils/scheduleAnalyzer.ts (TAM VE EKSİKSİZ HALİ) ---

import { Schedule, Teacher, Class, Subject, DAYS, PERIODS } from '../types';
import { UnassignedLesson } from '../types/wizard';

/**
 * Bir slotun (zaman diliminin) neden uygun olmadığını açıklayan arayüz.
 */
export interface SlotAnalysis {
  isAvailable: boolean;
  reasons: string[];
}

/**
 * İki dersin yer değiştirmesi için bir öneri yapısını tanımlar.
 */
export interface SwapSuggestion {
  type: 'SWAP';
  sourceLesson: UnassignedLesson;
  targetTeacher: Teacher;
  targetClass: Class;
  targetSubject: Subject;
  day: string;
  period: string;
  reason: string;
}

/**
 * Yerleştirilemeyen bir dersin, haftanın her saati için neden uygun olmadığını analiz eder.
 */
export function analyzeUnassignedLesson(
  lesson: UnassignedLesson,
  teacherSchedule: Schedule['schedule'],
  classSchedule: Schedule['schedule'],
  constraints: TimeConstraint[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[]
): { availableSlots: Set<string>, conflictReasons: Map<string, string[]> } {
  
  const availableSlots = new Set<string>();
  const conflictReasons = new Map<string, string[]>();

  // Öğretmen ve sınıf programlarını kontrol et
  if (!teacherSchedule || !classSchedule) {
    console.error("Öğretmen veya sınıf programı bulunamadı");
    return { availableSlots, conflictReasons };
  }

  DAYS.forEach(day => {
    PERIODS.forEach(period => {
      const slotKey = `${day}-${period}`;
      const reasons: string[] = [];

      const teacherSlot = teacherSchedule[day]?.[period];
      if (teacherSlot) {
        const conflictClass = allClasses.find(c => c.id === teacherSlot.classId);
        
        if (teacherSlot.isFixed) {
          reasons.push(`Öğretmen için sabit zaman dilimi: ${teacherSlot.subjectId || 'Sabit Periyot'}`);
        } else {
          const conflictSubject = allSubjects.find(s => s.id === teacherSlot.subjectId);
          reasons.push(`Öğretmen, ${conflictClass?.name || ''} sınıfına ${conflictSubject?.name || 'başka bir'} dersi veriyor.`);
        }
      }

      const classSlot = classSchedule[day]?.[period];
      if (classSlot) {
        if (classSlot.isFixed) {
          reasons.push(`Sınıf için sabit zaman dilimi: ${classSlot.subjectId || 'Sabit Periyot'}`);
        } else if (classSlot.teacherId !== lesson.teacherId) {
            const conflictTeacher = allTeachers.find(t => t.id === classSlot.teacherId);
            reasons.push(`Sınıf, ${conflictTeacher?.name || ''} öğretmeninden ders alıyor.`);
        }
      }
      
      const teacherConstraint = constraints.find(c => c.entityType === 'teacher' && c.entityId === lesson.teacherId && c.day === day && c.period === period);
      if (teacherConstraint?.constraintType === 'unavailable') {
        reasons.push(`Öğretmen kısıtlaması: Müsait değil (${teacherConstraint.reason || 'belirtilmemiş'}).`);
      } else if (teacherConstraint?.constraintType === 'restricted') {
        reasons.push(`Öğretmen kısıtlaması: Kısıtlı (${teacherConstraint.reason || 'belirtilmemiş'}).`);
      }

      const classConstraint = constraints.find(c => c.entityType === 'class' && c.entityId === lesson.classId && c.day === day && c.period === period);
      if (classConstraint?.constraintType === 'unavailable') {
        reasons.push(`Sınıf kısıtlaması: Müsait değil (${classConstraint.reason || 'belirtilmemiş'}).`);
      } else if (classConstraint?.constraintType === 'restricted') {
        reasons.push(`Sınıf kısıtlaması: Kısıtlı (${classConstraint.reason || 'belirtilmemiş'}).`);
      }
      
      if (reasons.length === 0) {
        availableSlots.add(slotKey);
      } else {
        conflictReasons.set(slotKey, [...new Set(reasons)]);
      }
    });
  });

  return { availableSlots, conflictReasons };
}

/**
 * Yerleştirilemeyen bir ders için olası takas önerileri üretir.
 */
export function generateSwapSuggestions(
  lessonToPlace: UnassignedLesson,
  allSchedules: Schedule[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[]
): SwapSuggestion[] {

  const suggestions: SwapSuggestion[] = [];
  const sourceTeacher = allTeachers.find(t => t.id === lessonToPlace.teacherId);
  const sourceClass = allClasses.find(c => c.id === lessonToPlace.classId);

  if (!sourceTeacher || !sourceClass) return [];

  const sourceClassSchedule = getClassSchedule(sourceClass.id, allSchedules);

  for (const day of DAYS) {
    for (const period of PERIODS) {
      if (!sourceClassSchedule[day]?.[period]) {
        const teacherSchedule = allSchedules.find(s => s.teacherId === sourceTeacher.id)?.schedule;
        const conflictingSlot = teacherSchedule?.[day]?.[period];

        if (conflictingSlot && conflictingSlot.classId && conflictingSlot.subjectId) {
            const targetClass = allClasses.find(c => c.id === conflictingSlot.classId);
            const targetSubject = allSubjects.find(s => s.id === conflictingSlot.subjectId);

            if (!targetClass || !targetSubject) continue;

            suggestions.push({
              type: 'SWAP',
              sourceLesson: lessonToPlace,
              targetTeacher: sourceTeacher,
              targetClass: targetClass,
              targetSubject: targetSubject,
              day,
              period,
              reason: `Bu saatte ${sourceTeacher.name} öğretmeni ${targetClass.name} sınıfına ${targetSubject.name} dersi veriyor. Bu dersi taşıyarak yer açabilirsiniz.`
            });

            if (suggestions.length >= 3) return suggestions;
        }
      }
    }
  }
  
  return suggestions;
}

function getClassSchedule(classId: string, allSchedules: Schedule[]): Schedule['schedule'] {
    const schedule: Schedule['schedule'] = {};
    DAYS.forEach(day => {
        schedule[day] = {};
        PERIODS.forEach(period => {
            schedule[day][period] = null;
            for(const s of allSchedules) {
                if(s.schedule[day]?.[period]?.classId === classId) {
                    schedule[day][period] = { ...s.schedule[day][period], teacherId: s.teacherId };
                    break;
                }
            }
        });
    });
    return schedule;
}

// --- END OF FILE src/utils/scheduleAnalyzer.ts ---