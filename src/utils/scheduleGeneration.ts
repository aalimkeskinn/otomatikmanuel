// --- START OF FILE src/utils/scheduleGeneration.ts (TAM VE EKSİKSİZ HALİ) ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData, UnassignedLesson } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

// Tarayıcının arayüzü güncellemesine ve diğer işleri yapmasına izin vermek için küçük bir bekleme fonksiyonu
const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

const LEVEL_ORDER: Record<'Anaokulu' | 'İlkokul' | 'Ortaokul', number> = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

/**
 * "Öncelikli Kısıtlı Görev" Algoritması (v46 - Sınıf Öğretmeni Mutlak Önceliği)
 * 1. Yoğun döngüleri asenkron hale getirerek tarayıcı kilitlenmelerini ve eklenti hatalarını önler.
 * 2. Öğretmenin rolüne göre günlük ders limitini uygular.
 * 3. Dersleri blok ve dağıtım şekillerine göre boşluklara dağıtır.
 * 4. İlkokul ve anaokulu sınıflarında sınıf öğretmenlerinin derslerini MUTLAK öncelikli olarak yerleştirir.
 * 5. Sınıf öğretmeni dersleri tamamen yerleştirilmeden diğer derslere geçilmez.
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
  console.log('🚀 Program oluşturma başlatıldı (v46 - Sınıf Öğretmeni Mutlak Önceliği)...');

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
          classScheduleGrids[classItem.id][day][lunchPeriod] = { isFixed: true, classId: 'fixed-period', subjectId: 'fixed-lunch' }; 
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
    priority: number; // Öncelik değeri: 0 = en yüksek (MUTLAK), 1 = çok yüksek, 5 = normal, 10 = düşük
  };
  
  const allTasks: PlacementTask[] = [];

  // Sınıf öğretmenlerini ve derslerini belirle
  const classTeacherMap = new Map<string, string>(); // classId -> teacherId
  allClasses.forEach(classItem => {
    if (classItem.classTeacherId) {
      classTeacherMap.set(classItem.id, classItem.classTeacherId);
    }
  });

  mappings.forEach(mapping => {
    let hoursLeft = mapping.weeklyHours;
    const distribution = mapping.distribution || [];
    
    // Öğretmen ve sınıf bilgilerini al
    const teacher = allTeachers.find(t => t.id === mapping.teacherId);
    const classItem = allClasses.find(c => c.id === mapping.classId);
    
    // Öncelik değerini belirle
    let priority = 5; // Varsayılan öncelik
    
    if (teacher && classItem) {
      const classLevel = getEntityLevel(classItem);
      const isClassTeacher = classItem.classTeacherId === teacher.id;
      const isSinifOgretmenligi = (teacher.branch || '').toUpperCase().includes('SINIF ÖĞRETMENLİĞİ');
      
      // İlkokul ve anaokulu sınıflarında sınıf öğretmenlerine MUTLAK öncelik ver
      if ((classLevel === 'İlkokul' || classLevel === 'Anaokulu') && isClassTeacher) {
        priority = 0; // MUTLAK öncelik - bu dersler kesinlikle önce yerleştirilecek
      }
      // Sınıf öğretmenliği branşındaki öğretmenlere çok yüksek öncelik ver
      else if ((classLevel === 'İlkokul' || classLevel === 'Anaokulu') && isSinifOgretmenligi) {
        priority = 1; // Çok yüksek öncelik
      }
      // Ortaokul sınıflarına normal öncelik ver
      else if (classLevel === 'Ortaokul') {
        priority = 5; // Normal öncelik
      }
    }
    
    const createTask = (blockLength: number, type: 'dist' | 'single', index: number): PlacementTask => ({
      mapping, blockLength, taskId: `${mapping.id}-${type}-${index}`, isPlaced: false, priority
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
  
  // Görevleri öncelik ve blok uzunluğuna göre sırala
  allTasks.sort((a, b) => {
    // Önce önceliğe göre sırala (düşük değer = yüksek öncelik)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Aynı öncelikte ise blok uzunluğuna göre sırala (uzun bloklar önce)
    return b.blockLength - a.blockLength;
  });
  
  console.log('📊 Görev önceliklendirmesi:', {
    absolutePriority: allTasks.filter(t => t.priority === 0).length,
    topPriority: allTasks.filter(t => t.priority === 1).length,
    normalPriority: allTasks.filter(t => t.priority === 5).length,
    totalTasks: allTasks.length
  });
  
  // AŞAMA 2: MUTLAK ÖNCELİKLİ DERSLERİ YERLEŞTİR (Sınıf Öğretmeni Dersleri)
  const absolutePriorityTasks = allTasks.filter(t => t.priority === 0);
  let unplacedAbsoluteTasks = [...absolutePriorityTasks];
  
  console.log(`🔝 MUTLAK ÖNCELİKLİ DERSLER: ${absolutePriorityTasks.length} ders`);
  
  // Mutlak öncelikli dersleri yerleştir
  while (unplacedAbsoluteTasks.length > 0) {
    const task = unplacedAbsoluteTasks.shift()!;
    
    // Her 20 denemede bir, tarayıcının diğer işleri yapmasına izin ver.
    await yieldToMainThread();

    const { mapping, blockLength } = task;
    const { teacherId, classId, subjectId } = mapping;
    const teacher = allTeachers.find(t => t.id === teacherId);
    const classItem = allClasses.find(c => c.id === classId);

    if (!teacher || !classItem) continue;
    
    // Sınıf öğretmenleri için günlük ders limiti daha yüksek
    const dailyLimit = 6; // Sınıf öğretmenleri için yüksek limit

    let placed = false;
    
    // Günleri sırayla dene (karıştırma)
    const dayOrder = [...DAYS];
    
    for (const day of dayOrder) {
        const currentDailyCount = dailyLessonCount.get(classId)?.get(day)?.get(subjectId) || 0;
        
        if ((currentDailyCount + blockLength) > dailyLimit) {
            continue;
        }

        // Periyotları sırayla dene (sabah saatlerini önceliklendir)
        let periodOrder = [...PERIODS];
        periodOrder.sort((a, b) => {
          const aNum = parseInt(a);
          const bNum = parseInt(b);
          if (isNaN(aNum) || isNaN(bNum)) return 0;
          return aNum - bNum; // Küçük sayılar (sabah saatleri) önce
        });

        for (let i = 0; i <= periodOrder.length - blockLength; i++) {
            let isAvailable = true;
            const periodIndices = [];
            
            // Blok için uygun ardışık periyotları bul
            for (let j = 0; j < blockLength; j++) {
              const periodIndex = periodOrder.indexOf(PERIODS[i+j]);
              if (periodIndex === -1) {
                isAvailable = false;
                break;
              }
              periodIndices.push(periodIndex);
            }
            
            if (!isAvailable) continue;
            
            // Tüm periyotların uygunluğunu kontrol et
            for (const periodIndex of periodIndices) {
              const period = periodOrder[periodIndex];
              const slotKey = `${day}-${period}`;
              if (teacherAvailability.get(teacherId)?.has(slotKey) || 
                  classAvailability.get(classId)?.has(slotKey) || 
                  constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
                  constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
                isAvailable = false;
                break;
              }
            }
            
            if (isAvailable) {
                // Tüm periyotlara yerleştir
                for (const periodIndex of periodIndices) {
                    const period = periodOrder[periodIndex];
                    const slotKey = `${day}-${period}`;
                    classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId };
                    teacherAvailability.get(teacherId)!.add(slotKey);
                    classAvailability.get(classId)!.add(slotKey);
                }
                
                // Günlük ders sayısını güncelle
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
        // Yerleştirilemeyen mutlak öncelikli görevleri tekrar dene
        unplacedAbsoluteTasks.push(task);
        
        // Sonsuz döngüyü önlemek için maksimum deneme sayısını kontrol et
        if (unplacedAbsoluteTasks.length === 1 && unplacedAbsoluteTasks[0] === task) {
          // Bu görev birkaç kez denendiyse ve yerleştirilemiyorsa, ilerle
          console.warn(`⚠️ Mutlak öncelikli görev yerleştirilemedi: ${task.mapping.classId} - ${task.mapping.subjectId}`);
          break;
        }
    }
  }
  
  // AŞAMA 3: DİĞER DERSLERİ YERLEŞTİRME DÖNGÜSÜ
  const regularTasks = allTasks.filter(t => t.priority > 0);
  let unplacedTasks = regularTasks.filter(t => !t.isPlaced);

  console.log(`📚 NORMAL ÖNCELİKLİ DERSLER: ${regularTasks.length} ders`);
  
  const maxAttempts = allTasks.length * 5; 
  let attempts = 0;

  while (unplacedTasks.length > 0 && attempts < maxAttempts) {
    const task = unplacedTasks.shift()!;
    attempts++;

    // Her 50 denemede bir, tarayıcının diğer işleri yapmasına izin ver.
    if (attempts % 50 === 0) {
      await yieldToMainThread();
    }

    const { mapping, blockLength, priority } = task;
    const { teacherId, classId, subjectId } = mapping;
    const teacher = allTeachers.find(t => t.id === teacherId);
    const classItem = allClasses.find(c => c.id === classId);

    if (!teacher || !classItem) continue;
    
    const isClassTeacher = classItem.classTeacherId === teacher.id;
    const isSinifOgretmenligi = (teacher.branch || '').toUpperCase().includes('SINIF ÖĞRETMENLİĞİ');
    const classLevel = getEntityLevel(classItem);
    
    // Günlük ders limiti - sınıf öğretmenleri için daha yüksek
    const dailyLimit = (isClassTeacher && (classLevel === 'İlkokul' || classLevel === 'Anaokulu')) ? 6 : 
                      (isSinifOgretmenligi ? 4 : 2);

    let placed = false;
    
    // Günleri önceliklendirme - sınıf öğretmenleri için tüm günleri kullan
    const dayOrder = [...DAYS];
    if (priority <= 2) {
      // Sınıf öğretmenleri için günleri karıştırma, sırayla yerleştir
    } else {
      // Diğer öğretmenler için günleri karıştır
      dayOrder.sort(() => Math.random() - 0.5);
    }
    
    for (const day of dayOrder) {
        const currentDailyCount = dailyLessonCount.get(classId)?.get(day)?.get(subjectId) || 0;
        
        if ((currentDailyCount + blockLength) > dailyLimit) {
            continue;
        }

        // Periyotları önceliklendirme - sınıf öğretmenleri için sabah saatlerini tercih et
        let periodOrder = [...PERIODS];
        if (priority <= 2 && (classLevel === 'İlkokul' || classLevel === 'Anaokulu')) {
          // Sınıf öğretmenleri için sabah saatlerini önceliklendir
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

        for (let i = 0; i <= periodOrder.length - blockLength; i++) {
            let isAvailable = true;
            const periodIndices = [];
            
            // Blok için uygun ardışık periyotları bul
            for (let j = 0; j < blockLength; j++) {
              const periodIndex = periodOrder.indexOf(PERIODS[i+j]);
              if (periodIndex === -1) {
                isAvailable = false;
                break;
              }
              periodIndices.push(periodIndex);
            }
            
            if (!isAvailable) continue;
            
            // Tüm periyotların uygunluğunu kontrol et
            for (const periodIndex of periodIndices) {
              const period = periodOrder[periodIndex];
              const slotKey = `${day}-${period}`;
              if (teacherAvailability.get(teacherId)?.has(slotKey) || 
                  classAvailability.get(classId)?.has(slotKey) || 
                  constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
                  constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
                isAvailable = false;
                break;
              }
            }
            
            if (isAvailable) {
                // Tüm periyotlara yerleştir
                for (const periodIndex of periodIndices) {
                    const period = periodOrder[periodIndex];
                    const slotKey = `${day}-${period}`;
                    classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId };
                    teacherAvailability.get(teacherId)!.add(slotKey);
                    classAvailability.get(classId)!.add(slotKey);
                }
                
                // Günlük ders sayısını güncelle
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