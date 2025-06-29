// --- START OF FILE src/utils/scheduleGeneration.ts (TAM VE EKSİKSİZ HALİ) ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, UnassignedLesson } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

/**
 * Belirli bir sınıf için TÜM sabit periyotları (Yemek, Hazırlık, Kahvaltılar vb.) program ızgarasına ekler.
 */
function addFixedPeriodsToGrid(grid: Schedule['schedule'], classLevel: 'Anaokulu' | 'İlkokul' | 'Ortaokul') {
  // Sabit periyotlar için temel slot
  const fixedSlot = { isFixed: true, classId: 'fixed-period' };
  
  // Seviyeye göre öğle yemeği periyodu
  const lunchPeriod = (classLevel === 'Ortaokul') ? '6' : '5';
  
  // Tüm sabit periyotları tanımla
  const fixedPeriodsMap: { [period: string]: ScheduleSlot } = {
    'prep': { ...fixedSlot, subjectId: 'fixed-prep' },
    'afternoon-breakfast': { ...fixedSlot, subjectId: 'fixed-afternoon-breakfast' },
    [lunchPeriod]: { ...fixedSlot, subjectId: 'fixed-lunch' },
  };
  
  // Ortaokul için kahvaltı periyodu ekle
  if (classLevel === 'Ortaokul') {
    fixedPeriodsMap['breakfast'] = { ...fixedSlot, subjectId: 'fixed-breakfast' };
  }
  
  // Tüm günler için sabit periyotları ekle
  DAYS.forEach(day => {
    Object.entries(fixedPeriodsMap).forEach(([period, slotData]) => {
      if (!grid[day]) grid[day] = {};
      grid[day][period] = slotData;
    });
  });
}

// Tarayıcının arayüzü güncellemesine ve diğer işlemleri yapmasına izin vermek için küçük bir bekleme fonksiyonu
const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Sistematik olarak, çakışmaları ve zaman kısıtlamalarını dikkate alarak ders programını oluşturur.
 * Bu versiyon, kilitlenmeleri önlemek için esnek bir "ders havuzu" ve "rastgele deneme" stratejisi kullanır.
 */
export async function generateSystematicSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[],
  globalRules: any
): Promise<EnhancedGenerationResult> {
  
  const startTime = Date.now();
  console.log('🚀 Program oluşturma başlatıldı (v44 - Asenkron + Dinamik Limit)...');

  // AŞAMA 1: VERİ MATRİSLERİNİ VE GÖREVLERİ HAZIRLA
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  const constraintMap = new Map<string, string>();
  const dailyLessonCount = new Map<string, Map<string, Map<string, number>>>();

  // Kısıtlamaları haritaya ekle
  timeConstraints.forEach(c => { 
    if (c.constraintType) {
      constraintMap.set(`${c.entityType}-${c.entityId}-${c.day}-${c.period}`, c.constraintType); 
    }
  });

  // Sınıf ızgaralarını ve kullanılabilirlik durumlarını hazırla
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
      
      // Seviyeye göre öğle yemeği periyodunu belirle
      const lunchPeriod = getEntityLevel(classItem) === 'Ortaokul' ? '6' : '5';
      
      // Öğle yemeği periyodunu sabit olarak işaretle
      if (PERIODS.includes(lunchPeriod)) {
        DAYS.forEach(day => { 
          classScheduleGrids[classItem.id][day][lunchPeriod] = { 
            isFixed: true, 
            classId: 'fixed-period', 
            subjectId: 'fixed-lunch' 
          }; 
          classAvailability.get(classItem.id)!.add(`${day}-${lunchPeriod}`); 
        });
      }
      
      // Hazırlık periyodunu ekle
      DAYS.forEach(day => {
        classScheduleGrids[classItem.id][day]['prep'] = {
          isFixed: true,
          classId: 'fixed-period',
          subjectId: 'fixed-prep'
        };
        classAvailability.get(classItem.id)!.add(`${day}-prep`);
      });
      
      // Ortaokul için kahvaltı periyodunu ekle
      if (getEntityLevel(classItem) === 'Ortaokul') {
        DAYS.forEach(day => {
          classScheduleGrids[classItem.id][day]['breakfast'] = {
            isFixed: true,
            classId: 'fixed-period',
            subjectId: 'fixed-breakfast'
          };
          classAvailability.get(classItem.id)!.add(`${day}-breakfast`);
        });
      }
      
      // İkindi kahvaltısı periyodunu ekle
      DAYS.forEach(day => {
        classScheduleGrids[classItem.id][day]['afternoon-breakfast'] = {
          isFixed: true,
          classId: 'fixed-period',
          subjectId: 'fixed-afternoon-breakfast'
        };
        classAvailability.get(classItem.id)!.add(`${day}-afternoon-breakfast`);
      });
    }
  });

  // Öğretmen kullanılabilirlik durumlarını hazırla
  const selectedTeacherIds = new Set(mappings.map(m => m.teacherId));
  selectedTeacherIds.forEach(teacherId => { 
    teacherAvailability.set(teacherId, new Set<string>()); 
    
    // Öğretmen kısıtlamalarını ekle
    timeConstraints.forEach(c => {
      if (c.entityType === 'teacher' && c.entityId === teacherId && c.constraintType === 'unavailable') {
        teacherAvailability.get(teacherId)!.add(`${c.day}-${c.period}`);
      }
    });
  });
  
  // Yerleştirme görevlerini hazırla
  type PlacementTask = { 
    mapping: SubjectTeacherMapping; 
    blockLength: number; 
    taskId: string; 
    isPlaced: boolean; 
  };
  
  const allTasks: PlacementTask[] = [];

  // Görevleri oluştur
  mappings.forEach(mapping => {
    let hoursLeft = mapping.weeklyHours;
    const distribution = mapping.distribution || [];
    
    const createTask = (blockLength: number, type: 'dist' | 'single', index: number): PlacementTask => ({
      mapping, blockLength, taskId: `${mapping.id}-${type}-${index}`, isPlaced: false
    });
    
    // Dağıtım şekli varsa ona göre görevleri oluştur
    if (distribution.length > 0 && globalRules.useDistributionPatterns) {
        distribution.forEach((block, index) => {
            if (block > 0 && hoursLeft >= block) {
                allTasks.push(createTask(block, 'dist', index));
                hoursLeft -= block;
            }
        });
    }
    
    // Kalan saatler için tekli görevler oluştur
    for (let i = 0; i < hoursLeft; i++) {
        allTasks.push(createTask(1, 'single', i));
    }
  });
  
  // Görevleri blok uzunluğuna göre sırala (büyükten küçüğe)
  allTasks.sort((a, b) => b.blockLength - a.blockLength);
  
  // AŞAMA 2 & 3: DERSLERİ YERLEŞTİRME DÖNGÜSÜ
  const maxAttempts = allTasks.length * 5; 
  let attempts = 0;
  let unplacedTasks = allTasks.filter(t => !t.isPlaced);

  // Yerleştirilemeyen görevleri yerleştirmeye çalış
  while (unplacedTasks.length > 0 && attempts < maxAttempts) {
    const task = unplacedTasks.shift()!;
    attempts++;

    // Her 50 denemede bir, tarayıcının diğer işleri yapmasına izin ver
    if (attempts % 50 === 0) {
      await yieldToMainThread();
    }

    const { mapping, blockLength } = task;
    const { teacherId, classId, subjectId } = mapping;
    const teacher = allTeachers.find(t => t.id === teacherId);

    if (!teacher) continue;
    
    // Öğretmen tipine göre günlük ders limiti belirle
    const isClassTeacher = (teacher.branch || '').toUpperCase().includes('SINIF ÖĞRETMENLİĞİ');
    const dailyLimit = isClassTeacher ? 4 : 2;

    let placed = false;
    
    // Günleri karıştırarak dene (rastgelelik ekler)
    for (const day of [...DAYS].sort(() => Math.random() - 0.5)) {
        // Günlük ders sayısını kontrol et
        const currentDailyCount = dailyLessonCount.get(classId)?.get(day)?.get(subjectId) || 0;
        
        // Günlük limit aşılacaksa bu günü atla
        if ((currentDailyCount + blockLength) > dailyLimit) {
            continue;
        }

        // Blok için uygun başlangıç periyodu ara
        for (let i = 0; i <= PERIODS.length - blockLength; i++) {
            let isAvailable = true;
            
            // Bloğun tüm periyotları için uygunluk kontrolü
            for (let j = 0; j < blockLength; j++) {
                const period = PERIODS[i+j];
                const slotKey = `${day}-${period}`;
                
                // Öğretmen veya sınıf müsait değilse ya da kısıtlama varsa
                if (teacherAvailability.get(teacherId)?.has(slotKey) || 
                    classAvailability.get(classId)?.has(slotKey) || 
                    constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
                    constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
                    isAvailable = false;
                    break;
                }
            }
            
            // Tüm periyotlar uygunsa bloğu yerleştir
            if (isAvailable) {
                for (let j = 0; j < blockLength; j++) {
                    const period = PERIODS[i + j];
                    const slotKey = `${day}-${period}`;
                    
                    // Programlara ekle
                    classScheduleGrids[classId][day][period] = { 
                        subjectId, 
                        teacherId, 
                        classId 
                    };
                    
                    // Kullanılabilirlik durumlarını güncelle
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

    // Yerleşemezse listenin sonuna tekrar ekle
    if (!placed) {
        unplacedTasks.push(task);
    }
  }
  
  // AŞAMA 4: SONUÇLARI DERLE
  const teacherSchedules: { [teacherId: string]: Schedule['schedule'] } = {};
  
  // Öğretmen programlarını başlat
  selectedTeacherIds.forEach(teacherId => { 
    teacherSchedules[teacherId] = {}; 
    DAYS.forEach(day => teacherSchedules[teacherId][day] = {}); 
  });
  
  // Sınıf programlarından öğretmen programlarını oluştur
  Object.entries(classScheduleGrids).forEach(([classId, grid]) => { 
    Object.entries(grid).forEach(([day, periods]) => { 
      Object.entries(periods).forEach(([period, slot]) => { 
        if (slot && slot.teacherId && !slot.isFixed) { 
          if (!teacherSchedules[slot.teacherId]) {
              teacherSchedules[slot.teacherId] = {}; 
              DAYS.forEach(d => teacherSchedules[slot.teacherId][d] = {});
          }
          teacherSchedules[slot.teacherId][day][period] = { 
            classId, 
            subjectId: slot.subjectId 
          }; 
        } 
      }); 
    }); 
  });
  
  // Öğretmen programlarını son formata dönüştür
  const finalSchedules = Object.entries(teacherSchedules).map(([teacherId, schedule]) => ({ 
    teacherId, 
    schedule, 
    updatedAt: new Date() 
  }));
  
  // İstatistikleri hesapla
  const totalLessonsToPlace = allTasks.reduce((sum, task) => sum + task.blockLength, 0);
  const placedLessons = allTasks.filter(t => t.isPlaced).reduce((sum, task) => sum + task.blockLength, 0);

  // Yerleştirilemeyen dersleri belirle
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
                  classId: classItem.id, 
                  className: classItem.name, 
                  subjectId: subject.id,
                  subjectName: subject.name, 
                  teacherId: teacher.id, 
                  teacherName: teacher.name,
                  missingHours: 0, 
                  totalHours: mapping.weeklyHours
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

// Yardımcı fonksiyon: Varlığın seviyesini döndürür
function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

// ScheduleSlot tipi tanımı (eksik olduğu için eklendi)
interface ScheduleSlot {
  subjectId?: string;
  classId?: string;
  teacherId?: string;
  isFixed?: boolean;
}
// --- END OF FILE src/utils/scheduleGeneration.ts ---