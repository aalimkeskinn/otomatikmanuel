// --- START OF FILE src/utils/scheduleGeneration.ts (TAM VE EKSİKSİZ HALİ) ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData, UnassignedLesson } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

// Tarayıcının arayüzü güncellemesine ve diğer işlemleri yapmasına izin vermek için küçük bir bekleme fonksiyonu
const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

const LEVEL_ORDER: Record<'Anaokulu' | 'İlkokul' | 'Ortaokul', number> = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

/**
 * "Öncelikli Kısıtlı Görev" Algoritması (v44 - Asenkron + Dinamik Limit)
 * 1. Yoğun döngüleri asenkron hale getirerek tarayıcı kilitlenmelerini ve eklenti hatalarını önler.
 * 2. Öğretmenin rolüne göre günlük ders limitini uygular.
 * 3. Dersleri blok ve dağıtım şekillerine göre boşluklara dağıtır.
 */
export async function generateSystematicSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[],
  globalRules: WizardData['constraints']['globalRules']
): Promise<EnhancedGenerationResult> {
  
  const startTime = Date.now();
  console.log('🚀 Program oluşturma başlatıldı (v44 - Asenkron + Dinamik Limit)...');

  // AŞAMA 1: VERİ MATRİSLERİNİ VE GÖREVLERİ HAZIRLA
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  const constraintMap = new Map<string, string>();
  const dailyLessonCount = new Map<string, Map<string, Map<string, number>>>();

  timeConstraints.forEach(c => { 
    if (c.constraintType) {
      constraintMap.set(`${c.entityType}-${c.entityId}-${c.day}-${c.period}`, c.constraintType); 
    }
  });

  const selectedClassIds = new Set(mappings.map(m => m.classId));
  allClasses.forEach(classItem => {
    if (selectedClassIds.has(classItem.id)) {
      classScheduleGrids[classItem.id] = {};
      classAvailability.set(classItem.id, new Set<string>());
      dailyLessonCount.set(classItem.id, new Map());
      
      DAYS.forEach(day => { 
        classScheduleGrids[classItem.id][day] = {}; 
        dailyLessonCount.get(classItem.id)!.set(day, new Map());
      });
      
      const lunchPeriod = getEntityLevel(classItem) === 'Ortaokul' ? '6' : '5';
      if (PERIODS.includes(lunchPeriod)) {
        DAYS.forEach(day => { 
          classScheduleGrids[classItem.id][day][lunchPeriod] = { isFixed: true, classId: 'fixed-period', subjectId: 'Yemek' }; 
          classAvailability.get(classItem.id)!.add(`${day}-${lunchPeriod}`); 
        });
      }
    }
  });

  const selectedTeacherIds = new Set(mappings.map(m => m.teacherId));
  selectedTeacherIds.forEach(teacherId => { teacherAvailability.set(teacherId, new Set<string>()); });
  
  type PlacementTask = { 
    mapping: SubjectTeacherMapping; 
    blockLength: number; 
    taskId: string; 
    isPlaced: boolean; 
  };
  
  const allTasks: PlacementTask[] = [];

  mappings.forEach(mapping => {
    let hoursLeft = mapping.weeklyHours;
    const distribution = mapping.distribution || [];
    
    const createTask = (blockLength: number, type: 'dist' | 'single', index: number): PlacementTask => ({
      mapping, blockLength, taskId: `${mapping.id}-${type}-${index}`, isPlaced: false
    });
    
    if (distribution.length > 0 && globalRules.useDistributionPatterns) {
        distribution.forEach((block, index) => {
            if (block > 0 && hoursLeft >= block) {
                allTasks.push(createTask(block, 'dist', index));
                hoursLeft -= block;
            }
        });
    }
    for (let i = 0; i < hoursLeft; i++) {
        allTasks.push(createTask(1, 'single', i));
    }
  });
  
  allTasks.sort((a, b) => b.blockLength - a.blockLength);
  
  // AŞAMA 2 & 3: DERSLERİ YERLEŞTİRME DÖNGÜSÜ
  const maxAttempts = allTasks.length * 5; 
  let attempts = 0;
  let unplacedTasks = allTasks.filter(t => !t.isPlaced);

  while (unplacedTasks.length > 0 && attempts < maxAttempts) {
    const task = unplacedTasks.shift()!;
    attempts++;

    // Her 50 denemede bir, tarayıcının diğer işleri yapmasına izin ver.
    if (attempts % 50 === 0) {
      await yieldToMainThread();
    }

    const { mapping, blockLength } = task;
    const { teacherId, classId, subjectId } = mapping;
    const teacher = allTeachers.find(t => t.id === teacherId);

    if (!teacher) continue;
    
    const isClassTeacher = (teacher.branch || '').toUpperCase().includes('SINIF ÖĞRETMENLİĞİ');
    const dailyLimit = isClassTeacher ? 4 : 2;

    let placed = false;
    for (const day of [...DAYS].sort(() => Math.random() - 0.5)) {
        const currentDailyCount = dailyLessonCount.get(classId)?.get(day)?.get(subjectId) || 0;
        
        if ((currentDailyCount + blockLength) > dailyLimit) {
            continue;
        }

        for (let i = 0; i <= PERIODS.length - blockLength; i++) {
            let isAvailable = true;
            for (let j = 0; j < blockLength; j++) {
                const period = PERIODS[i+j];
                const slotKey = `${day}-${period}`;
                if (teacherAvailability.get(teacherId)?.has(slotKey) || classAvailability.get(classId)?.has(slotKey) || constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
                    isAvailable = false;
                    break;
                }
            }
            if (isAvailable) {
                for (let j = 0; j < blockLength; j++) {
                    const period = PERIODS[i + j];
                    const slotKey = `${day}-${period}`;
                    classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId };
                    teacherAvailability.get(teacherId)!.add(slotKey);
                    classAvailability.get(classId)!.add(slotKey);
                }
                const dayCountMap = dailyLessonCount.get(classId)!.get(day)!;
                dayCountMap.set(subjectId, currentDailyCount + blockLength);
                
                placed = true;
                task.isPlaced = true;
                break;
            }
        }
        if (placed) break;
    }

    if (!placed) {
        unplacedTasks.push(task); // Yerleşemezse listenin sonuna tekrar ekle
    }
  }
  
  // AŞAMA 4: SONUÇLARI DERLE
  const teacherSchedules: { [teacherId: string]: Schedule['schedule'] } = {};
  selectedTeacherIds.forEach(teacherId => { 
    teacherSchedules[teacherId] = {}; 
    DAYS.forEach(day => teacherSchedules[teacherId][day] = {}); 
  });
  
  Object.entries(classScheduleGrids).forEach(([classId, grid]) => { 
    Object.entries(grid).forEach(([day, periods]) => { 
      Object.entries(periods).forEach(([period, slot]) => { 
        if (slot && slot.teacherId && !slot.isFixed) { 
          if (!teacherSchedules[slot.teacherId]) {
              teacherSchedules[slot.teacherId] = {}; 
              DAYS.forEach(d => teacherSchedules[slot.teacherId][d] = {});
          }
          teacherSchedules[slot.teacherId][day][period] = { classId, subjectId: slot.subjectId }; 
        } 
      }); 
    }); 
  });
  
  const finalSchedules = Object.entries(teacherSchedules).map(([teacherId, schedule]) => ({ teacherId, schedule, updatedAt: new Date() }));
  
  const totalLessonsToPlace = allTasks.reduce((sum, task) => sum + task.blockLength, 0);
  const placedLessons = allTasks.filter(t => t.isPlaced).reduce((sum, task) => sum + task.blockLength, 0);

  const unassignedLessonsMap = new Map<string, UnassignedLesson>();
  allTasks.filter(task => !task.isPlaced).forEach(task => {
      const { mapping } = task;
      const key = `${mapping.classId}-${mapping.subjectId}-${mapping.teacherId}`;
      const classItem = allClasses.find(c => c.id === mapping.classId);
      const subject = allSubjects.find(s => s.id === mapping.subjectId);
      const teacher = allTeachers.find(t => t.id === mapping.teacherId);
      
      if (classItem && subject && teacher) {
          if (!unassignedLessonsMap.has(key)) {
              unassignedLessonsMap.set(key, {
                  classId: classItem.id, className: classItem.name, subjectId: subject.id,
                  subjectName: subject.name, teacherId: teacher.id, teacherName: teacher.name,
                  missingHours: 0, totalHours: mapping.weeklyHours
              });
          }
          const lesson = unassignedLessonsMap.get(key);
          if(lesson) {
            lesson.missingHours += task.blockLength;
          }
      }
  });

  const unassignedLessons = Array.from(unassignedLessonsMap.values());
  const warnings: string[] = [];
  if (unassignedLessons.length > 0) { 
      warnings.push("Tüm ders saatleri yerleştirilemedi. Kısıtlamalar ve yoğun programlar nedeniyle bazı dersler boşta kalmış olabilir."); 
  }
  
  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye. Sonuç: ${placedLessons} / ${totalLessonsToPlace}`);
  
  return {
    success: true,
    schedules: finalSchedules,
    statistics: { totalLessonsToPlace, placedLessons, unassignedLessons },
    warnings,
    errors: [],
  };
}
// --- END OF FILE src/utils/scheduleGeneration.ts ---