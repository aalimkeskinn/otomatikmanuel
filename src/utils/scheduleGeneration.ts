// --- START OF FILE src/utils/scheduleGeneration.ts ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject, parseDistributionPattern } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData, UnassignedLesson } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

// Tarayıcının arayüzü güncellemesine ve diğer işleri yapmasına izin vermek için küçük bir bekleme fonksiyonu
const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Belirli bir sınıf için TÜM sabit periyotları (Yemek, Hazırlık, Kahvaltılar vb.) program ızgarasına ekler.
 */
function addFixedPeriodsToGrid(grid: Schedule['schedule'], classLevel: 'Anaokulu' | 'İlkokul' | 'Ortaokul') {
  const fixedSlot = { isFixed: true, classId: 'fixed-period' };
  const lunchPeriod = (classLevel === 'Ortaokul') ? '6' : '5';
  const fixedPeriodsMap = {
    'prep': { ...fixedSlot, subjectId: 'fixed-prep' },
    'afternoon-breakfast': { ...fixedSlot, subjectId: 'fixed-afternoon-breakfast' },
    [lunchPeriod]: { ...fixedSlot, subjectId: 'fixed-lunch' },
  };
  if (classLevel === 'Ortaokul') {
    fixedPeriodsMap['breakfast'] = { ...fixedSlot, subjectId: 'fixed-breakfast' };
  }
  DAYS.forEach(day => {
    Object.entries(fixedPeriodsMap).forEach(([period, slotData]) => {
      grid[day][period] = slotData;
    });
  });
}

/**
 * Sistematik olarak, çakışmaları ve zaman kısıtlamalarını dikkate alarak ders programını oluşturur.
 * Bu versiyon, ders dağıtım şekillerini (2+2+2 gibi) dikkate alır ve buna göre yerleştirme yapar.
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
  console.log('🚀 Program oluşturma başlatıldı (Dağıtım şekli desteği ile)...');

  // AŞAMA 1: VERİ MATRİSLERİNİ VE GÖREVLERİ HAZIRLA
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  const constraintMap = new Map<string, string>();
  
  // Kulüp dersleri için özel slotlar
  const clubSlots = {
    'Ortaokul': { day: 'Perşembe', periods: ['7', '8'] },
    'İlkokul': { day: 'Perşembe', periods: ['9', '10'] }
  };
  
  // Sınıf ve öğretmen bazında toplam ders saati takibi
  const classWeeklyHours = new Map<string, number>(); // Yerleştirilen ders saatleri
  const teacherWeeklyHours = new Map<string, number>(); // Yerleştirilen ders saatleri
  
  // Sınıf bazında hedef ders saati (varsayılan 45)
  const classTargetHours = new Map<string, number>();
  
  // Öğretmen bazında hedef ders saati (atanan derslerden hesaplanacak)
  const teacherTargetHours = new Map<string, number>();

  // Eğitim seviyesi bazında sınıfları grupla
  const classesByLevel = {
    'Anaokulu': [] as Class[],
    'İlkokul': [] as Class[],
    'Ortaokul': [] as Class[]
  };

  timeConstraints.forEach(c => { 
    if (c.constraintType) {
      constraintMap.set(`${c.entityType}-${c.entityId}-${c.day}-${c.period}`, c.constraintType); 
    }
  });

  const selectedClassIds = new Set(mappings.map(m => m.classId));
  allClasses.forEach(classItem => {
    if (selectedClassIds.has(classItem.id)) {
      // Eğitim seviyesine göre sınıfı grupla
      const level = classItem.level || (classItem.levels || [])[0] || 'İlkokul';
      classesByLevel[level].push(classItem);
      
      classScheduleGrids[classItem.id] = {};
      classAvailability.set(classItem.id, new Set<string>());
      classWeeklyHours.set(classItem.id, 0); // Sınıf için haftalık ders saati sayacı
      classTargetHours.set(classItem.id, 45); // Her sınıf için hedef 45 saat
      
      DAYS.forEach(day => { 
        classScheduleGrids[classItem.id][day] = {}; 
      });
      
      // Sabit periyotları ekle (yemek, teneffüs vb.)
      addFixedPeriodsToGrid(classScheduleGrids[classItem.id], level);
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
    const currentTarget = teacherTargetHours.get(teacherId) || 0;
    teacherTargetHours.set(teacherId, currentTarget + mapping.weeklyHours);
  });
  
  // Dağıtım şekli bilgilerini hazırla
  const subjectDistributions = new Map<string, number[]>();
  allSubjects.forEach(subject => {
    if (subject.distributionPattern && globalRules.useDistributionPatterns) {
      const distribution = parseDistributionPattern(subject.distributionPattern);
      if (distribution.length > 0 && distribution.reduce((a, b) => a + b, 0) === subject.weeklyHours) {
        subjectDistributions.set(subject.id, [...distribution]); // Kopya oluştur
        console.log(`🔄 Dağıtım şekli: ${subject.name} - ${subject.distributionPattern}`);
      }
    }
  });

  // Kulüp derslerini belirle
  const clubSubjectIds = new Set<string>();
  allSubjects.forEach(subject => {
    if (subject.name.toLowerCase().includes('kulüp')) {
      clubSubjectIds.add(subject.id);
      console.log(`🎭 Kulüp dersi tespit edildi: ${subject.name}`);
    }
  });
  
  // Sınıf öğretmenlerini belirle
  const classTeacherMap = new Map<string, string>(); // classId -> teacherId
  allClasses.forEach(classItem => {
    if (classItem.classTeacherId) {
      classTeacherMap.set(classItem.id, classItem.classTeacherId);
    }
  });

  // Yerleştirme görevlerini oluştur
  type PlacementTask = { 
    mapping: SubjectTeacherMapping; 
    blockLength: number; 
    taskId: string; 
    isPlaced: boolean;
    priority: number; // Öncelik değeri: 0 = en yüksek, 10 = düşük
    distributionDay?: number; // Dağıtım şekli için gün indeksi
    retryCount: number; // Yeniden deneme sayacı
  };
  
  const allTasks: PlacementTask[] = [];

  // Görevleri oluştur
  mappings.forEach(mapping => {
    let hoursLeft = mapping.weeklyHours;
    const subject = allSubjects.find(s => s.id === mapping.subjectId);
    const isClubSubject = subject && clubSubjectIds.has(subject.id);
    const classItem = allClasses.find(c => c.id === mapping.classId);
    const teacher = allTeachers.find(t => t.id === mapping.teacherId);
    
    // Öncelik değerini belirle
    let priority = 5; // Varsayılan öncelik
    
    if (isClubSubject) {
      priority = 2; // Kulüp dersleri için yüksek öncelik
    }
    
    if (teacher && classItem) {
      const classLevel = classItem.level || (classItem.levels || [])[0] || 'İlkokul';
      const isClassTeacher = classItem.classTeacherId === teacher.id;
      
      // Anaokulu sınıflarına yüksek öncelik ver
      if (classLevel === 'Anaokulu') {
        priority = isClassTeacher ? 0 : 1;
      }
      // İlkokul sınıflarında sınıf öğretmenlerine yüksek öncelik ver
      else if (classLevel === 'İlkokul' && isClassTeacher) {
        priority = 0;
      }
    }

    // Dağıtım şekli kontrolü
    let distribution: number[] = [];
    if (subject?.distributionPattern && globalRules.useDistributionPatterns) {
      distribution = subjectDistributions.get(subject.id) || [];
    } else if (mapping.distribution && mapping.distribution.length > 0) {
      distribution = mapping.distribution;
    }
    
    // Görevleri oluştur
    if (distribution.length > 0 && globalRules.useDistributionPatterns) {
      // Dağıtım şekline göre görevler oluştur
      distribution.forEach((blockLength, index) => {
        if (blockLength > 0 && hoursLeft >= blockLength) {
          allTasks.push({
            mapping, 
            blockLength, 
            taskId: `${mapping.id}-dist-${index}`, 
            isPlaced: false, 
            priority,
            distributionDay: index,
            retryCount: 0
          });
          hoursLeft -= blockLength;
        }
      });
    }
    
    // Kalan saatler için tekli görevler oluştur
    for (let i = 0; i < hoursLeft; i++) {
      allTasks.push({
        mapping, 
        blockLength: 1, 
        taskId: `${mapping.id}-single-${i}`, 
        isPlaced: false, 
        priority,
        retryCount: 0
      });
    }
  });
  
  // Görevleri önceliğe göre sırala
  allTasks.sort((a, b) => {
    // Önce önceliğe göre sırala (düşük değer = yüksek öncelik)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Aynı öncelikte ise blok uzunluğuna göre sırala (uzun bloklar önce)
    return b.blockLength - a.blockLength;
  });
  
  // AŞAMA 2: KULÜP DERSLERİNİ OTOMATİK YERLEŞTIR
  console.log('🎭 Kulüp derslerini otomatik yerleştirme başlatılıyor...');
  
  // Kulüp dersleri için görevleri bul
  const clubTasks = allTasks.filter(task => {
    const subject = allSubjects.find(s => s.id === task.mapping.subjectId);
    return subject && clubSubjectIds.has(subject.id);
  });
  
  // Her kulüp dersi için
  for (const task of clubTasks) {
    const { mapping } = task;
    const { teacherId, classId, subjectId } = mapping;
    const classItem = allClasses.find(c => c.id === classId);
    if (!classItem) continue;
    
    const classLevel = classItem.level || (classItem.levels || [])[0] || 'İlkokul';
    if (classLevel !== 'İlkokul' && classLevel !== 'Ortaokul') continue;
    
    // Kulüp dersi için uygun slotları belirle
    const slots = clubSlots[classLevel];
    if (!slots) continue;
    
    const { day, periods } = slots;
    
    // Her periyot için dene
    for (const period of periods) {
      // Slot zaten dolu mu kontrol et
      if (classScheduleGrids[classId][day][period] !== undefined && 
          classScheduleGrids[classId][day][period] !== null) {
        continue;
      }
      
      const slotKey = `${day}-${period}`;
      if (teacherAvailability.get(teacherId)?.has(slotKey) || 
          classAvailability.get(classId)?.has(slotKey) || 
          constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
          constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
        continue;
      }
      
      // Kulüp dersini yerleştir
      classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId };
      teacherAvailability.get(teacherId)!.add(slotKey);
      classAvailability.get(classId)!.add(slotKey);
      
      // Haftalık ders saati sayaçlarını güncelle
      classWeeklyHours.set(classId, (classWeeklyHours.get(classId) || 0) + 1);
      teacherWeeklyHours.set(teacherId, (teacherWeeklyHours.get(teacherId) || 0) + 1);
      
      // Yerleştirilen ders sayısını güncelle
      mapping.assignedHours++;
      task.isPlaced = true;
      
      console.log(`✅ Kulüp dersi otomatik yerleştirildi: ${classItem.name} - ${day} ${period}. ders`);
      
      // Bir ders saati yerleştirdik, sonraki derse geç
      break;
    }
  }
  
  // AŞAMA 3: DİĞER DERSLERİ YERLEŞTİR
  console.log('📚 Diğer dersleri yerleştirme başlatılıyor...');
  
  // Yerleştirilen görev sayısı
  let placedTasksCount = 0;
  
  // Eğitim seviyesi sıralaması: Anaokulu -> İlkokul -> Ortaokul
  const levelOrder = ['Anaokulu', 'İlkokul', 'Ortaokul'] as const;
  
  // Her eğitim seviyesi için
  for (const level of levelOrder) {
    console.log(`🏫 ${level} seviyesi işleniyor...`);
    const classesInLevel = classesByLevel[level];
    
    // Her sınıf için
    for (const classItem of classesInLevel) {
      console.log(`📚 ${classItem.name} sınıfı işleniyor...`);
      
      // Bu sınıfa ait görevleri bul
      const classTasks = allTasks.filter(t => 
        t.mapping.classId === classItem.id && !t.isPlaced
      );
      
      if (classTasks.length === 0) {
        console.log(`ℹ️ ${classItem.name} sınıfı için yerleştirilecek ders yok, sonraki sınıfa geçiliyor.`);
        continue;
      }
      
      // Sınıf öğretmeni görevlerini önce yerleştir
      const classTeacherTasks = classTasks.filter(t => 
        classItem.classTeacherId === t.mapping.teacherId
      );
      
      // Diğer görevler
      const otherClassTasks = classTasks.filter(t => 
        !classTeacherTasks.includes(t)
      );
      
      // Günlere dengeli dağıtım için sayaç
      const dayCount = new Map<string, number>();
      DAYS.forEach(day => dayCount.set(day, 0));
      
      // Önce sınıf öğretmeni derslerini yerleştir
      console.log(`👨‍🏫 ${classItem.name} sınıfı için ${classTeacherTasks.length} sınıf öğretmeni dersi yerleştiriliyor...`);
      
      for (const task of classTeacherTasks) {
        if (task.isPlaced) continue;
        
        const { mapping, blockLength, distributionDay } = task;
        const { teacherId, classId, subjectId } = mapping;
        
        // Günleri dengeli dağıtım için sırala
        let dayOrder = [...DAYS];
        
        // Dağıtım şekli varsa, belirli bir gün için yerleştirme yap
        if (distributionDay !== undefined && distributionDay < dayOrder.length) {
          dayOrder = [dayOrder[distributionDay]];
        } else {
          // Günleri, o güne atanan ders sayısına göre sırala (az olan önce)
          dayOrder.sort((a, b) => {
            const countA = dayCount.get(a) || 0;
            const countB = dayCount.get(b) || 0;
            return countA - countB;
          });
        }
        
        let placed = false;
        
        // Her gün için dene
        for (const day of dayOrder) {
          if (placed) break;
          
          // Günlük ders sayısını kontrol et
          const currentDailyCount = dayCount.get(day) || 0;
          
          // Günlük limit - eğitim seviyesine göre
          const dailyLimit = level === 'Anaokulu' ? 45 : level === 'İlkokul' ? 12 : 8;
          
          // Günlük limit aşıldıysa bu günü atla (Anaokulu hariç)
          if (currentDailyCount >= dailyLimit && level !== 'Anaokulu') {
            continue;
          }
          
          // Periyotları sırala - sabah saatlerini önceliklendir
          let periodOrder = [...PERIODS];
          periodOrder.sort((a, b) => {
            const aNum = parseInt(a);
            const bNum = parseInt(b);
            if (isNaN(aNum) || isNaN(bNum)) return 0;
            return aNum - bNum; // Küçük sayılar (sabah saatleri) önce
          });
          
          // Blok yerleştirme için tüm olası başlangıç noktalarını dene
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
                
                // Günlük sayacı güncelle
                dayCount.set(day, (dayCount.get(day) || 0) + 1);
                
                console.log(`✅ Sınıf öğretmeni dersi yerleştirildi: ${classItem.name} - ${day} ${period}. ders`);
              }
              
              placed = true;
              task.isPlaced = true;
              placedTasksCount++;
              
              // Yerleştirilen ders sayısını güncelle
              mapping.assignedHours += blockLength;
              
              break;
            }
          }
        }
        
        // Yerleştirilemedi, tekrar dene
        if (!placed) {
          task.retryCount++;
          
          // Yeniden deneme sayısını kontrol et
          if (task.retryCount < 100) {
            // Sınıf öğretmeni dersleri için daha fazla deneme
            classTeacherTasks.push(task);
          } else {
            console.warn(`⚠️ Sınıf öğretmeni dersi ${task.retryCount} kez denendi ve yerleştirilemedi: ${classItem.name} - ${subjectId}`);
          }
        }
      }
      
      // Son olarak diğer dersleri yerleştir
      console.log(`📚 ${classItem.name} sınıfı için ${otherClassTasks.length} diğer ders yerleştiriliyor...`);
      
      for (const task of otherClassTasks) {
        if (task.isPlaced) continue;
        
        const { mapping, blockLength, distributionDay } = task;
        const { teacherId, classId, subjectId } = mapping;
        const subject = allSubjects.find(s => s.id === subjectId);
        
        if (!subject) continue;
        
        // Günleri dengeli dağıtım için sırala
        let dayOrder = [...DAYS];
        
        // Dağıtım şekli varsa, belirli bir gün için yerleştirme yap
        if (distributionDay !== undefined && distributionDay < dayOrder.length) {
          dayOrder = [dayOrder[distributionDay]];
        } else {
          // Günleri karıştır (dengeli dağıtım için)
          dayOrder.sort(() => Math.random() - 0.5);
        }
        
        let placed = false;
        
        // Her gün için dene
        for (const day of dayOrder) {
          if (placed) break;
          
          // Günlük ders sayısını kontrol et
          const currentDailyCount = dayCount.get(day) || 0;
          
          // Günlük limit - eğitim seviyesine göre
          const dailyLimit = level === 'Anaokulu' ? 45 : level === 'İlkokul' ? 10 : 8;
          
          // Günlük limit aşıldıysa bu günü atla (Anaokulu hariç)
          if (currentDailyCount >= dailyLimit && level !== 'Anaokulu') {
            continue;
          }
          
          // Periyotları sırala - eğitim seviyesine göre
          let periodOrder = [...PERIODS];
          if (level === 'Anaokulu' || level === 'İlkokul') {
            // Anaokulu ve ilkokul için sabah saatlerini önceliklendir
            periodOrder.sort((a, b) => {
              const aNum = parseInt(a);
              const bNum = parseInt(b);
              if (isNaN(aNum) || isNaN(bNum)) return 0;
              return aNum - bNum; // Küçük sayılar (sabah saatleri) önce
            });
          } else {
            // Ortaokul için periyotları karıştır
            periodOrder.sort(() => Math.random() - 0.5);
          }
          
          // Blok yerleştirme için tüm olası başlangıç noktalarını dene
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
                
                // Günlük sayacı güncelle
                dayCount.set(day, (dayCount.get(day) || 0) + 1);
                
                console.log(`✅ Ders yerleştirildi: ${classItem.name} - ${subject.name} - ${day} ${period}. ders`);
              }
              
              placed = true;
              task.isPlaced = true;
              placedTasksCount++;
              
              // Yerleştirilen ders sayısını güncelle
              mapping.assignedHours += blockLength;
              
              break;
            }
          }
        }
        
        // Yerleştirilemedi, tekrar dene
        if (!placed) {
          task.retryCount++;
          
          // Yeniden deneme sayısını kontrol et
          if (task.retryCount < 50) {
            // Birkaç kez daha dene
            otherClassTasks.push(task);
          }
        }
      }
      
      // Tarayıcının diğer işleri yapmasına izin ver
      await yieldToMainThread();
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
  
  // Yerleştirilen ve yerleştirilemeyen dersleri hesapla (istatistikler)
  const placedTasks = allTasks.filter(t => t.isPlaced);
  const placedLessons = placedTasks.reduce((sum, task) => sum + task.blockLength, 0);
  const totalLessonsToPlace = allTasks.reduce((sum, task) => sum + task.blockLength, 0);
  
  // Yerleştirilemeyen dersleri raporla
  const unassignedLessonsMap = new Map<string, UnassignedLesson>();
  allTasks.filter(task => !task.isPlaced).forEach(task => {
    const { mapping, blockLength } = task;
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
  }

  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye. Sonuç: ${placedLessons} / ${totalLessonsToPlace} (${Math.round(placedLessons/totalLessonsToPlace*100)}%)`);

  return {
    success: true,
    schedules: finalSchedules,
    statistics: { 
      totalLessonsToPlace, 
      placedLessons, 
      unassignedLessons 
    },
    warnings,
    errors: [],
  };
}
// --- END OF FILE src/utils/scheduleGeneration.ts ---