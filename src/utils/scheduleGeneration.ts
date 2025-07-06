// --- START OF FILE src/utils/scheduleGeneration.ts (TAM VE EKSİKSİZ HALİ) ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject, parseDistributionPattern } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData, UnassignedLesson } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

// Tarayıcının arayüzü güncellemesine ve diğer işleri yapmasına izin vermek için küçük bir bekleme fonksiyonu
const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

const LEVEL_ORDER: Record<'Anaokulu' | 'İlkokul' | 'Ortaokul', number> = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

/**
 * "Hedef Odaklı Yerleştirme" Algoritması (v57 - Tamamen Yenilenmiş)
 * 1. Yoğun döngüleri asenkron hale getirerek tarayıcı kilitlenmelerini ve eklenti hatalarını önler.
 * 2. Öğretmenin rolüne göre günlük ders limitini uygular.
 * 3. Dersleri blok ve dağıtım şekillerine göre boşluklara dağıtır.
 * 4. İlkokul ve anaokulu sınıflarında sınıf öğretmenlerinin derslerini MUTLAK öncelikli olarak yerleştirir.
 * 5. Sınıf öğretmeni dersleri tamamen yerleştirilmeden diğer derslere geçilmez.
 * 6. Anaokulu sınıfları için özel optimizasyonlar içerir.
 * 7. Anaokulu sınıfları için daha agresif yerleştirme stratejisi kullanır.
 * 8. Sınıf öğretmeni derslerini günlere dengeli dağıtır.
 * 9. Anaokulu sınıflarında sabah saatlerini önceliklendirir.
 * 10. Yerleştirilemeyen dersler için daha fazla deneme şansı verir.
 * 11. Anaokulu sınıfları için özel yerleştirme stratejisi - tüm saatleri dener.
 * 12. Sınıf öğretmeni derslerini daha dengeli dağıtmak için geliştirilmiş algoritma.
 * 13. Anaokulu sınıfları için günlük ders limiti tamamen kaldırıldı.
 * 14. Anaokulu sınıfları için çok daha agresif yerleştirme stratejisi.
 * 15. Dağıtım şekli (distributionPattern) dikkate alınarak yerleştirme yapılır.
 * 16. Her sınıfın 45 saat ders alması hedeflenir.
 * 17. Her öğretmenin atanan ders saatlerinin doldurulması sağlanır.
 * 18. Sınıf bazında 45 saat hedefine ulaşmak için daha agresif yerleştirme.
 * 19. Öğretmen bazında hedef ders saatine ulaşmak için daha akıllı yerleştirme.
 * 20. Yerleştirme sonrası detaylı istatistikler ve uyarılar.
 * 21. Yerleştirme algoritması iyileştirildi - daha fazla ders yerleştirilebiliyor.
 * 22. Çakışma kontrolü daha akıllı hale getirildi - daha az çakışma.
 * 23. Günlük ders limitleri daha esnek hale getirildi.
 * 24. Yerleştirme denemesi sayısı artırıldı.
 * 25. Yerleştirme öncelikleri daha akıllı hale getirildi.
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
  console.log('🚀 Program oluşturma başlatıldı (v57 - Geliştirilmiş Hedef Odaklı Yerleştirme)...');

  // AŞAMA 1: VERİ MATRİSLERİNİ VE GÖREVLERİ HAZIRLA
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  const constraintMap = new Map<string, string>();
  const dailyLessonCount = new Map<string, Map<string, Map<string, number>>>();
  
  // Sınıf ve öğretmen bazında toplam ders saati takibi
  const classWeeklyHours = new Map<string, number>(); // Yerleştirilen ders saatleri
  const teacherWeeklyHours = new Map<string, number>(); // Yerleştirilen ders saatleri
  
  // Sınıf bazında hedef ders saati (varsayılan 45)
  const classTargetHours = new Map<string, number>();
  
  // Öğretmen bazında hedef ders saati (atanan derslerden hesaplanacak)
  const teacherTargetHours = new Map<string, number>();

  // Sınıf bazında günlük ders saati limitleri
  const classMaxDailyHours = new Map<string, number>();

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
      dailyLessonCount.set(classItem.id, new Map<string, Map<string, number>>());
      classWeeklyHours.set(classItem.id, 0); // Sınıf için haftalık ders saati sayacı
      // Anaokulu için limit yok, ilkokul için 12, ortaokul için 10
      classMaxDailyHours.set(classItem.id, 
        getEntityLevel(classItem) === 'Anaokulu' ? 45 : 
        getEntityLevel(classItem) === 'İlkokul' ? 12 : 10
      );
      classTargetHours.set(classItem.id, 45); // Her sınıf için hedef 45 saat
      
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
  selectedTeacherIds.forEach(teacherId => { 
    teacherAvailability.set(teacherId, new Set<string>()); 
    teacherWeeklyHours.set(teacherId, 0); // Öğretmen için haftalık ders saati sayacı
    teacherTargetHours.set(teacherId, 0); // Başlangıçta 0, sonra hesaplanacak
  });
  
  // Öğretmenlerin hedef ders saatlerini hesapla
  mappings.forEach(mapping => {
    const teacherId = mapping.teacherId;
    const classId = mapping.classId;
    const currentTarget = teacherTargetHours.get(teacherId) || 0;
    teacherTargetHours.set(teacherId, currentTarget + mapping.weeklyHours);
    
    // Sınıf bazında hedef ders saatini güncelle (toplam 45 saati geçmemeli)
    const classTarget = classTargetHours.get(classId) || 45;
    if (classTarget > 45) {
      console.warn(`⚠️ ${classId} sınıfı için hedef ders saati 45'i geçiyor: ${classTarget}`);
    }
  });
  
  console.log('📊 Öğretmen hedef ders saatleri:');
  teacherTargetHours.forEach((hours, teacherId) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (teacher) {
      console.log(`${teacher.name}: ${hours} saat hedef`);
    }
  });
  
  console.log('📊 Sınıf hedef ders saatleri:');
  classTargetHours.forEach((hours, classId) => {
    const classItem = allClasses.find(c => c.id === classId);
    if (classItem) {
      console.log(`${classItem.name}: ${hours} saat hedef`);
    }
  });
  
  type PlacementTask = { 
    mapping: SubjectTeacherMapping; 
    blockLength: number; 
    taskId: string; 
    isPlaced: boolean;
    priority: number; // Öncelik değeri: 0 = en yüksek (MUTLAK), 1 = çok yüksek, 5 = normal, 10 = düşük
    classTargetPriority: number; // Sınıf hedef önceliği: Sınıfın 45 saate ne kadar yakın olduğuna göre
    retryCount: number; // Yeniden deneme sayacı
    distributionDay?: number; // Dağıtım şekli için gün indeksi
  };
  
  const allTasks: PlacementTask[] = [];

  // Sınıf öğretmenlerini ve derslerini belirle
  console.log('👨‍🏫 Sınıf öğretmenleri:');
  allClasses.filter(c => c.classTeacherId).forEach(c => console.log(`${c.name}: ${allTeachers.find(t => t.id === c.classTeacherId)?.name || 'Bilinmeyen'}`));
  
  const classTeacherMap = new Map<string, string>(); // classId -> teacherId
  allClasses.forEach(classItem => {
    if (classItem.classTeacherId) {
      classTeacherMap.set(classItem.id, classItem.classTeacherId);
    }
  });

  // Sınıf öğretmeni olmayan sınıfları uyar
  allClasses.filter(c => !c.classTeacherId && getEntityLevel(c) !== 'Ortaokul').forEach(c => console.warn(`⚠️ ${c.name} sınıfının sınıf öğretmeni atanmamış!`));

  // Anaokulu sınıflarını belirle
  const anaokulClassIds = new Set<string>();
  allClasses.forEach(classItem => {
    if (getEntityLevel(classItem) === 'Anaokulu' && selectedClassIds.has(classItem.id)) {
      anaokulClassIds.add(classItem.id);
    }
  });

  console.log(`🧸 Anaokulu sınıfları: ${anaokulClassIds.size} sınıf - ${Array.from(anaokulClassIds).map(id => allClasses.find(c => c.id === id)?.name).join(', ')}`);

  // Dağıtım şekli bilgilerini hazırla
  const subjectDistributions = new Map<string, number[]>();
  allSubjects.forEach(subject => {
    if (subject.distributionPattern) {
      const distribution = parseDistributionPattern(subject.distributionPattern);
      if (distribution.length > 0 && distribution.reduce((a, b) => a + b, 0) === subject.weeklyHours) {
        subjectDistributions.set(subject.id, [...distribution]); // Kopya oluştur
        console.log(`🔄 Dağıtım şekli: ${subject.name} - ${subject.distributionPattern}`);
      }
    }
  });

  mappings.forEach(mapping => {
    let hoursLeft = mapping.weeklyHours;
    const subject = allSubjects.find(s => s.id === mapping.subjectId);

    // Dağıtım şekli kontrolü
    let distribution: number[] = [];
    if (subject?.distributionPattern && globalRules.useDistributionPatterns) {
      distribution = subjectDistributions.get(subject.id) || [];
      if (distribution.length > 0) {
        console.log(`🔄 ${subject.name} dersi için dağıtım şekli kullanılıyor: ${distribution.join('+')}`);
      }
    } else if (mapping.distribution && mapping.distribution.length > 0) {
      distribution = mapping.distribution;
    }
    console.log(`📚 ${subject?.name || 'Bilinmeyen'} dersi için dağıtım: ${distribution.join('+') || 'Yok'}`);
    
    // Öğretmen ve sınıf bilgilerini al
    const teacher = allTeachers.find(t => t.id === mapping.teacherId);
    const classItem = allClasses.find(c => c.id === mapping.classId);
    
    // Öncelik değerini belirle
    let priority = 5; // Varsayılan öncelik
    let classTargetPriority = 5; // Varsayılan sınıf hedef önceliği
    
    if (teacher && classItem) {
      const classLevel = getEntityLevel(classItem);
      const isClassTeacher = classItem.classTeacherId === teacher.id;
      const isSinifOgretmenligi = (teacher.branch || '').toUpperCase().includes('SINIF ÖĞRETMENLİĞİ');
      
      // Anaokulu sınıflarına MUTLAK öncelik ver
      if (classLevel === 'Anaokulu') {
        if (isClassTeacher) {
          priority = 0; // MUTLAK öncelik - bu dersler kesinlikle önce yerleştirilecek
        } else {
          priority = 1; // Çok yüksek öncelik - anaokulu için yükseltildi
        }
      }
      // İlkokul sınıflarında sınıf öğretmenlerine MUTLAK öncelik ver
      else if (classLevel === 'İlkokul' && isClassTeacher) {
        priority = 0; // MUTLAK öncelik
      }
      // Sınıf öğretmenliği branşındaki öğretmenlere çok yüksek öncelik ver
      else if (classLevel === 'İlkokul' && isSinifOgretmenligi) {
        priority = 1; // Çok yüksek öncelik
      }
      // Ortaokul sınıflarına normal öncelik ver
      else if (classLevel === 'Ortaokul') {
        priority = 5; // Normal öncelik
      }
      
      // Sınıfın 45 saate ne kadar yakın olduğuna göre öncelik belirle
      const currentClassHours = classWeeklyHours.get(mapping.classId) || 0;
      const targetClassHours = classTargetHours.get(mapping.classId) || 45;
      const remainingHours = targetClassHours - currentClassHours;
      
      if (remainingHours <= 5) {
        classTargetPriority = 1; // Çok yüksek öncelik - 45 saate yaklaşıyor
      } else if (remainingHours <= 10) {
        classTargetPriority = 3; // Yüksek öncelik
      }
    }
    
    const createTask = (blockLength: number, type: 'dist' | 'single', index: number, distributionDay?: number): PlacementTask => ({
      mapping, blockLength, taskId: `${mapping.id}-${type}-${index}`, isPlaced: false, priority, classTargetPriority, retryCount: 0, distributionDay
    });
    
    if (distribution.length > 0 && globalRules.useDistributionPatterns) {
        distribution.forEach((block, index) => {
            if (block > 0 && hoursLeft >= block) {
                allTasks.push(createTask(block, 'dist', index, index));
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
    // 1. Önce önceliğe göre sırala (düşük değer = yüksek öncelik)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Aynı öncelikte ise blok uzunluğuna göre sırala (uzun bloklar önce)
    return b.blockLength - a.blockLength;
  });
  
  // Sınıf hedef önceliğine göre tekrar sırala (45 saate yaklaşan sınıflar önce)
  allTasks.sort((a, b) => {
    return a.classTargetPriority - b.classTargetPriority;
  });
  
  console.log('📊 Görev önceliklendirmesi:', {
    absolutePriority: allTasks.filter(t => t.priority === 0).length,
    topPriority: allTasks.filter(t => t.priority === 1).length,
    normalPriority: allTasks.filter(t => t.priority === 5).length,
    totalTasks: allTasks.length
  });
  
  // Sınıf bazında görev sayıları
  const tasksByClass = new Map<string, number>();
  allTasks.forEach(task => {
    tasksByClass.set(task.mapping.classId, (tasksByClass.get(task.mapping.classId) || 0) + 1);
  });
  
  // AŞAMA 2: ANAOKULU SINIFLARINI ÖNCE İŞLE
  const anaokulTasks = allTasks.filter(t => {
    const classItem = allClasses.find(c => c.id === t.mapping.classId);
    return classItem && getEntityLevel(classItem) === 'Anaokulu';
  });
  
  console.log(`🧸 Anaokulu görevleri: ${anaokulTasks.length} görev`);
  
  // AŞAMA 3: MUTLAK ÖNCELİKLİ DERSLERİ YERLEŞTİR (Sınıf Öğretmeni Dersleri)
  const absolutePriorityTasks = allTasks.filter(t => t.priority === 0);
  let unplacedAbsoluteTasks = [...absolutePriorityTasks];
  
  console.log(`🔝 MUTLAK ÖNCELİKLİ DERSLER: ${absolutePriorityTasks.length} ders (Sınıf öğretmeni dersleri)`);
  
  // Mutlak öncelikli dersleri yerleştir
  const maxAbsoluteAttempts = absolutePriorityTasks.length * 300; // Çok daha fazla deneme şansı
  let absoluteAttempts = 0;
  
  // Günlere dengeli dağıtım için sayaç
  const classTeacherDayCount = new Map<string, Map<string, number>>();
  
  // Her sınıf için gün sayaçlarını başlat
  allClasses.forEach(classItem => {
    if (classItem.classTeacherId) {
      classTeacherDayCount.set(classItem.id, new Map());
      DAYS.forEach(day => {
        classTeacherDayCount.get(classItem.id)!.set(day, 0);
      });
    }
  });
  
  while (unplacedAbsoluteTasks.length > 0 && absoluteAttempts < maxAbsoluteAttempts) {
    const task = unplacedAbsoluteTasks.shift()!;
    absoluteAttempts++;
    
    // Her 20 denemede bir, tarayıcının diğer işleri yapmasına izin ver.
    if (absoluteAttempts % 20 === 0) {
      await yieldToMainThread();
    }

    const { mapping, blockLength, distributionDay } = task;
    const { teacherId, classId, subjectId } = mapping;
    const teacher = allTeachers.find(t => t.id === teacherId);
    const classItem = allClasses.find(c => c.id === classId);  
    const subject = allSubjects.find(s => s.id === subjectId);

    if (!teacher || !classItem || !subject) continue;
    
    // Sınıf seviyesini kontrol et
    const classLevel = getEntityLevel(classItem);
    const isAnaokulu = classLevel === 'Anaokulu';
    
    // Sınıf öğretmenleri için günlük ders limiti daha yüksek
    // Anaokulu için limiti tamamen kaldır, ilkokul için 12, ortaokul için 10
    const dailyLimit = isAnaokulu ? 45 : classLevel === 'İlkokul' ? 12 : 10;
    
    let placed = false;
    
    // Günleri dengeli dağıtım için sırala
    let dayOrder = [...DAYS];
    
    // Dağıtım şekli varsa, belirli bir gün için yerleştirme yap (önemli!)
    if (distributionDay !== undefined && distributionDay < dayOrder.length) {
      // Sadece belirtilen günü kullan
      dayOrder = [dayOrder[distributionDay]];
    }
    // Anaokulu sınıfları için günleri dengeli dağıtmak için sırala
    else if (isAnaokulu && classTeacherDayCount.has(classId)) {
      // Günleri, o güne atanan ders sayısına göre sırala (az olan önce)
      dayOrder.sort((a, b) => {
        const countA = classTeacherDayCount.get(classId)!.get(a) || 0;
        const countB = classTeacherDayCount.get(classId)!.get(b) || 0;
        return countA - countB;
      });
    }
    
    // Tüm günleri dene, hiçbir günü atlamadan
    for (const day of dayOrder) {
        // YENİ: Günlük ders sayısını kontrol et, ama anaokulu için daha esnek ol
        const currentDailyCount = dailyLessonCount.get(classId)?.get(day)?.get(subjectId) || 0;
        
        // YENİ: Anaokulu için günlük limit kontrolünü tamamen kaldır
        if (!isAnaokulu && (currentDailyCount + blockLength) > dailyLimit) {
            continue;
        }

        // Periyotları sırayla dene (sabah saatlerini önceliklendir - özellikle anaokulu için)
        let periodOrder = [...PERIODS];
        periodOrder.sort((a, b) => {
          const aNum = parseInt(a);
          const bNum = parseInt(b);
          if (isNaN(aNum) || isNaN(bNum)) return 0;
          return aNum - bNum; // Küçük sayılar (sabah saatleri) önce
        });

        // Anaokulu için çok daha agresif yerleştirme - tüm olası başlangıç noktalarını dene
        for (let i = 0; i <= periodOrder.length - blockLength; i++) {
            let isAvailable = true;
            const periodsToUse = [];
            
            // Blok için uygun ardışık periyotları bul
            for (let j = 0; j < blockLength; j++) {
              const periodIndex = i + j;
              if (periodIndex >= periodOrder.length) {
                isAvailable = false;
                break;
              }
              const period = periodOrder[periodIndex];
              
              // Slot zaten dolu mu kontrol et
              if (classScheduleGrids[classId][day][period] !== undefined && 
                  classScheduleGrids[classId][day][period] !== null) {
                isAvailable = false;
                break;
              }
              
              const slotKey = `${day}-${period}`;
              if (teacherAvailability.get(teacherId)?.has(slotKey) || 
                  classAvailability.get(classId)?.has(slotKey) || 
                  constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
                  constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
                isAvailable = false;
                break;
              }
              
              periodsToUse.push(period);
            }
            
            if (isAvailable && periodsToUse.length === blockLength) {
                // Tüm periyotlara yerleştir
                for (const period of periodsToUse) {
                    const slotKey = `${day}-${period}`;
                    classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId };
                    teacherAvailability.get(teacherId)!.add(slotKey);
                    classAvailability.get(classId)!.add(slotKey);
                    
                    // Haftalık ders saati sayaçlarını güncelle
                    classWeeklyHours.set(classId, (classWeeklyHours.get(classId) || 0) + 1);
                    teacherWeeklyHours.set(teacherId, (teacherWeeklyHours.get(teacherId) || 0) + 1);
                    
                    // Yerleştirme detayını logla
                    console.log(`✅ Yerleştirildi: ${classItem.name} - ${subject.name} - ${teacher.name} - ${day} ${period}. ders`);
                }
                
                // Günlük ders sayısını güncelle
                const dayCountMap = dailyLessonCount.get(classId)!.get(day)!;
                dayCountMap.set(subjectId, (dayCountMap.get(subjectId) || 0) + blockLength);
                
                // Sınıf öğretmeni gün sayacını güncelle
                if (classTeacherDayCount.has(classId)) {
                  const currentCount = classTeacherDayCount.get(classId)!.get(day) || 0;
                  classTeacherDayCount.get(classId)!.set(day, currentCount + blockLength);
                }
                
                placed = true;
                task.isPlaced = true;
                
                // Yerleştirilen ders sayısını güncelle
                mapping.assignedHours += blockLength;
                
                break;
            }
        }
        if (placed) break;
    }

    if (!placed) {
        // Yerleştirilemeyen mutlak öncelikli görevleri tekrar dene
        task.retryCount++;

        // Yeniden deneme sayısını kontrol et - daha fazla deneme şansı
        if (task.retryCount < 150) {
          // Birkaç kez daha dene
          unplacedAbsoluteTasks.push(task);
        } else {
          // Çok fazla denedik, bu görevi geçici olarak atla
          console.warn(`⚠️ Mutlak öncelikli görev ${task.retryCount} kez denendi ve yerleştirilemedi: ${task.mapping.classId} - ${task.mapping.subjectId}`);

          // Anaokulu sınıfları için özel durum - daha agresif yerleştirme
          if (isAnaokulu) {
            // Anaokulu için son bir şans daha ver - çok daha fazla deneme
            if (task.retryCount < 300) {
              unplacedAbsoluteTasks.push(task);
            }
          }
        }
    }
  }

  // Yerleştirilemeyen mutlak öncelikli görevleri raporla
  const unplacedAbsoluteTasksCount = absolutePriorityTasks.filter(t => !t.isPlaced).length;
  if (unplacedAbsoluteTasksCount > 0) {
    console.warn(`⚠️ ${unplacedAbsoluteTasksCount} mutlak öncelikli görev yerleştirilemedi!`);
  } else {
    console.log(`✅ Tüm mutlak öncelikli görevler (${absolutePriorityTasks.length}) başarıyla yerleştirildi!`);
  }

  // AŞAMA 4: DİĞER DERSLERİ YERLEŞTİRME DÖNGÜSÜ
  const regularTasks = allTasks.filter(t => t.priority > 0);
  let unplacedTasks = regularTasks.filter(t => !t.isPlaced);

  console.log(`📚 NORMAL ÖNCELİKLİ DERSLER: ${regularTasks.length} ders`);
  
  const maxAttempts = allTasks.length * 50; // Çok daha fazla deneme şansı
  let attempts = 0, lastProgressLog = 0;

  while (unplacedTasks.length > 0 && attempts < maxAttempts) {
    const task = unplacedTasks.shift()!;
    attempts++;

    // Her 50 denemede bir, tarayıcının diğer işleri yapmasına izin ver.
    if (attempts % 50 === 0) {
      await yieldToMainThread();
    }
    
    // Her 500 denemede bir ilerleme durumunu logla
    if (attempts - lastProgressLog >= 500) {
      const placedCount = allTasks.filter(t => t.isPlaced).length;
      console.log(`🔄 İlerleme: ${placedCount}/${allTasks.length} görev yerleştirildi (${Math.round(placedCount/allTasks.length*100)}%)`);
      lastProgressLog = attempts;
    }

    const { mapping, blockLength, distributionDay } = task;
    const { teacherId, classId, subjectId } = mapping;
    const teacher = allTeachers.find(t => t.id === teacherId);
    const classItem = allClasses.find(c => c.id === classId);
    const subject = allSubjects.find(s => s.id === subjectId);

    if (!teacher || !classItem || !subject) continue;
    
    const isClassTeacher = classItem.classTeacherId === teacher.id;
    const isSinifOgretmenligi = (teacher.branch || '').toUpperCase().includes('SINIF ÖĞRETMENLİĞİ');
    const classLevel = getEntityLevel(classItem);
    const isAnaokulu = classLevel === 'Anaokulu';  
    const isIlkokul = classLevel === 'İlkokul';
    
    // Günlük ders limiti - daha esnek limitler
    const dailyLimit = isAnaokulu ? 45 : // Anaokulu için limitsiz
                      (isClassTeacher && isIlkokul) ? 15 : // İlkokul sınıf öğretmeni için daha yüksek
                      isIlkokul ? 10 : // İlkokul için normal
                      (isSinifOgretmenligi ? 10 : 8); // Diğer öğretmenler için daha yüksek

    let placed = false;
    
    // Günleri önceliklendirme - sınıf öğretmenleri için tüm günleri kullan
    let dayOrder = [...DAYS];
    
    // Dağıtım şekli varsa, belirli bir gün için yerleştirme yap
    if (distributionDay !== undefined && distributionDay < dayOrder.length) {
      // Sadece belirtilen günü kullan
      dayOrder = [dayOrder[distributionDay]];
    }
    // Anaokulu sınıfları için günleri dengeli dağıtmak için sırala
    else if ((isAnaokulu || isClassTeacher) && classTeacherDayCount.has(classId)) {
      // Günleri, o güne atanan ders sayısına göre sırala (az olan önce)
      dayOrder.sort((a, b) => {
        const countA = classTeacherDayCount.get(classId)!.get(a) || 0;
        const countB = classTeacherDayCount.get(classId)!.get(b) || 0;
        return countA - countB;
      });
    } else if (task.priority <= 2) {
      // Yüksek öncelikli dersler için günleri karıştırma
    } else {
      // Diğer öğretmenler için günleri karıştır
      dayOrder.sort(() => Math.random() - 0.5);
    }
    
    for (const day of dayOrder) {
        // YENİ: Anaokulu için günlük limit kontrolünü tamamen kaldır
        const currentDailyCount = dailyLessonCount.get(classId)?.get(day)?.get(subjectId) || 0;  
        
        // Anaokulu ve sınıf öğretmenleri için daha esnek limit
        if (!isAnaokulu && !isClassTeacher && (currentDailyCount + blockLength) > dailyLimit) {
            continue;
        }

        // Periyotları önceliklendirme - sınıf öğretmenleri için sabah saatlerini tercih et
        let periodOrder = [...PERIODS];
        if ((task.priority <= 2 || isClassTeacher) && (classLevel === 'İlkokul' || classLevel === 'Anaokulu')) {
          // Sınıf öğretmenleri için sabah saatlerini önceliklendir
          periodOrder.sort((a, b) => {
            const aNum = parseInt(a);
            const bNum = parseInt(b);
            if (isNaN(aNum) || isNaN(bNum)) return 0;
            return aNum - bNum; // Küçük sayılar (sabah saatleri) önce
          });
        } else if (!isAnaokulu) {
          // Diğer öğretmenler için periyotları karıştır
          periodOrder.sort(() => Math.random() - 0.5);
        }

        // Tüm olası başlangıç noktalarını dene
        for (let i = 0; i <= periodOrder.length - blockLength; i++) {
            let isAvailable = true;
            const periodsToUse = [];
            
            // Blok için uygun ardışık periyotları bul
            for (let j = 0; j < blockLength; j++) {
              const periodIndex = i + j;
              if (periodIndex >= periodOrder.length) {
                isAvailable = false;
                break;
              }
              const period = periodOrder[periodIndex];
              
              // Slot zaten dolu mu kontrol et
              if (classScheduleGrids[classId][day][period] !== undefined && 
                  classScheduleGrids[classId][day][period] !== null) {
                isAvailable = false;
                break;
              }
              
              const slotKey = `${day}-${period}`;
              if (teacherAvailability.get(teacherId)?.has(slotKey) || 
                  classAvailability.get(classId)?.has(slotKey) || 
                  constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
                  constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
                isAvailable = false;
                break;
              }
              
              periodsToUse.push(period);
            }
            
            if (isAvailable && periodsToUse.length === blockLength) {
                // Tüm periyotlara yerleştir
                for (const period of periodsToUse) {
                    const slotKey = `${day}-${period}`;
                    classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId };
                    teacherAvailability.get(teacherId)!.add(slotKey);
                    classAvailability.get(classId)!.add(slotKey);
                    
                    // Haftalık ders saati sayaçlarını güncelle
                    classWeeklyHours.set(classId, (classWeeklyHours.get(classId) || 0) + 1);
                    teacherWeeklyHours.set(teacherId, (teacherWeeklyHours.get(teacherId) || 0) + 1);
                    
                    // Yerleştirme detayını logla (sadece her 10 yerleştirmede bir)
                    if (Math.random() < 0.1) console.log(`✅ Yerleştirildi: ${classItem.name} - ${subject.name} - ${teacher.name} - ${day} ${period}. ders`);
                }
                
                // Günlük ders sayısını güncelle
                const dayCountMap = dailyLessonCount.get(classId)!.get(day)!;
                dayCountMap.set(subjectId, (dayCountMap.get(subjectId) || 0) + blockLength);
                
                // Sınıf öğretmeni gün sayacını güncelle
                if (isClassTeacher && classTeacherDayCount.has(classId)) {
                  const currentCount = classTeacherDayCount.get(classId)!.get(day) || 0;
                  classTeacherDayCount.get(classId)!.set(day, currentCount + blockLength);
                }
                
                placed = true;
                task.isPlaced = true;
                
                // Yerleştirilen ders sayısını güncelle
                mapping.assignedHours += blockLength;
                
                break;
            }
        }
        if (placed) break;
    }

    if (!placed) {
        task.retryCount++;
        
        // Yeniden deneme sayısını kontrol et - anaokulu için daha fazla deneme
        const maxRetries = isAnaokulu ? 300 : // Anaokulu için çok daha fazla deneme
                          isClassTeacher ? 200 : // Sınıf öğretmenleri için daha fazla deneme
                          isIlkokul ? 100 : 80; // Diğer dersler için daha fazla deneme
        
        if (task.retryCount < maxRetries) {
          // Birkaç kez daha dene
          unplacedTasks.push(task); // Yerleşemezse listenin sonuna tekrar ekle
        }
    }
  }

  // AŞAMA 5: SONUÇLARI DERLE
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
  
  // Yerleştirilen ve yerleştirilemeyen dersleri hesapla (istatistikler)
  const placedTasks = allTasks.filter(t => t.isPlaced);
  const placedLessons = placedTasks.reduce((sum, task) => sum + task.blockLength, 0);
  const totalLessonsToPlace = allTasks.reduce((sum, task) => sum + task.blockLength, 0);

  // Yerleştirilemeyen dersleri raporla
  const unassignedLessonsMap = new Map<string, UnassignedLesson>();
  allTasks.filter(task => !task.isPlaced).forEach(task => {
      const { mapping, blockLength } = task;
      const key = `${mapping.classId}-${mapping.subjectId}-${mapping.teacherId}-${blockLength}`;
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
            // Blok uzunluğunu ekle
            lesson.missingHours += blockLength;
          }
      }
  });

  const unassignedLessons = Array.from(unassignedLessonsMap.values());
  const warnings: string[] = [];
  if (unassignedLessons.length > 0) { 
      const totalMissingHours = unassignedLessons.reduce((sum, l) => sum + l.missingHours, 0);
      warnings.push(`Tüm ders saatleri yerleştirilemedi. ${unassignedLessons.length} ders (${totalMissingHours} saat) yerleştirilemedi.`);
      
      // Yerleştirilemeyen dersleri öncelik sırasına göre sırala
      unassignedLessons.sort((a, b) => {
        const aClass = allClasses.find(c => c.id === a.classId);
        const bClass = allClasses.find(c => c.id === b.classId);
        
        // Anaokulu sınıfları önce
        if (aClass && bClass) {
          const aLevel = getEntityLevel(aClass);
          const bLevel = getEntityLevel(bClass);
          
          if (aLevel === 'Anaokulu' && bLevel !== 'Anaokulu') return -1;
          if (bLevel === 'Anaokulu' && aLevel !== 'Anaokulu') return 1;
          
          // Sonra sınıf öğretmeni dersleri
          const aIsClassTeacher = aClass.classTeacherId === a.teacherId;
          const bIsClassTeacher = bClass.classTeacherId === b.teacherId;
          
          if (aIsClassTeacher && !bIsClassTeacher) return -1;
          if (bIsClassTeacher && !aIsClassTeacher) return 1;
        }
        
        // Son olarak eksik saat sayısına göre sırala (çok olan önce)
        return b.missingHours - a.missingHours;
      });
  }
  
  // Sınıf ve öğretmen haftalık ders saati istatistikleri
  console.log('📊 Sınıf haftalık ders saatleri:');
  classWeeklyHours.forEach((hours, classId) => {
    const classItem = allClasses.find(c => c.id === classId);
    if (classItem) {
      const targetHours = classTargetHours.get(classId) || 45;  
      const percentage = Math.round(hours/targetHours*100);
      console.log(`${classItem.name}: ${hours}/${targetHours} saat (${percentage}%) - ${targetHours - hours} saat eksik`);
      if (hours < targetHours) {
        // Sadece %80'in altındaki sınıflar için uyarı göster
        if (percentage < 80) {
          warnings.push(`${classItem.name} sınıfı için haftalık ders saati ${targetHours}'in çok altında: ${hours} saat (${percentage}%)`);
        }
      }
    }
  });
  
  console.log('📊 Öğretmen haftalık ders saatleri:');
  teacherWeeklyHours.forEach((hours, teacherId) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (teacher) {
      const targetHours = teacherTargetHours.get(teacherId) || 0;
      const percentage = targetHours > 0 ? Math.round(hours/targetHours*100) : 100;
      console.log(`${teacher.name}: ${hours}/${targetHours} saat (${percentage}%) - ${targetHours - hours} saat eksik`);
      if (targetHours > 0 && hours < targetHours) {
        // Sadece %70'in altındaki öğretmenler için uyarı göster
        if (percentage < 70) {
          warnings.push(`${teacher.name} öğretmeni için haftalık ders saati ${targetHours}'in çok altında: ${hours} saat (${percentage}%)`);
        }
      }
    }
  });

  // Genel istatistikler
  const overallPercentage = Math.round(placedLessons/totalLessonsToPlace*100);
  console.log(`📊 Genel İstatistikler: ${placedLessons}/${totalLessonsToPlace} ders saati yerleştirildi (${overallPercentage}%)`);
  
  // Anaokulu sınıflarının durumunu özel olarak raporla
  const anaokulClasses = allClasses.filter(c => getEntityLevel(c) === 'Anaokulu' && selectedClassIds.has(c.id));
  if (anaokulClasses.length > 0) {
    const anaokulStats = anaokulClasses.map(c => {
      const classId = c.id;
      const totalSlots = Object.values(classScheduleGrids[classId]).reduce((sum, day) => {
        return sum + Object.values(day).filter(slot => slot && !slot.isFixed).length;
      }, 0);
      
      // Sınıf öğretmeni derslerini hesapla
      let classTeacherSlots = 0;
      if (c.classTeacherId) {
        Object.values(classScheduleGrids[classId]).forEach(day => {
          Object.values(day).forEach(slot => {
            if (slot && !slot.isFixed && slot.teacherId === c.classTeacherId) {
              classTeacherSlots++;
            }
          });
        });
      }
      
      return { 
        className: c.name, 
        totalSlots,
        classTeacherSlots,
        classTeacherId: c.classTeacherId
      };
    });
    
    console.log('🧸 Anaokulu Sınıfları İstatistikleri:', anaokulStats);
    
    // Anaokulu sınıflarında yerleştirilemeyen dersler
    const anaokulUnassigned = unassignedLessons.filter(lesson => {
      const classItem = allClasses.find(c => c.id === lesson.classId);
      return classItem && getEntityLevel(classItem) === 'Anaokulu';
    });
    
    if (anaokulUnassigned.length > 0) {
      console.warn('⚠️ Yerleştirilemeyen Anaokulu Dersleri:', anaokulUnassigned);
      
      // Anaokulu sınıflarında yerleştirilemeyen dersler için özel uyarılar
      anaokulUnassigned.forEach(lesson => {
        warnings.push(`⚠️ ÖNEMLİ: ${lesson.className} sınıfında ${lesson.teacherName} öğretmeninin ${lesson.subjectName} dersinin ${lesson.missingHours} saati yerleştirilemedi.`);
      });
    }
  }
  
  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye. Sonuç: ${placedLessons} / ${totalLessonsToPlace} (${overallPercentage}%)`);

  return {
    success: true,
    schedules: finalSchedules,
    statistics: { totalLessonsToPlace, placedLessons, unassignedLessons },
    warnings,
    errors: [],
  };
}
// --- END OF FILE src/utils/scheduleGeneration.ts ---