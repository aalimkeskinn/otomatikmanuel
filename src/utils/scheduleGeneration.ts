// --- START OF FILE src/utils/scheduleGeneration.ts ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject, parseDistributionPattern } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData, UnassignedLesson } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';
import { stringToHslColor } from './colorUtils';

// Eğitim seviyesini belirlemek için yardımcı fonksiyon
const LEVEL_ORDER: Record<'Anaokulu' | 'İlkokul' | 'Ortaokul', number> = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

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
 * Ayrıca her sınıfın 45 saat zorunluluğunu ve derslerin blok olarak yerleştirilmesini sağlar.
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
  const dailyLessonCount = new Map<string, Map<string, Map<string, number>>>();
  const classSubjectColors = new Map<string, Map<string, string>>();
  
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
  
  // Öğretmen bazında hedef ders saati
  const teacherTargetHours = new Map<string, number>();

  // Sınıf bazında günlük ders saati limitleri
  const classMaxDailyHours = new Map<string, number>();

  // Sınıf bazında ders renkleri
  allClasses.forEach(classItem => {
    classSubjectColors.set(classItem.id, new Map<string, string>());
  });

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
      const level = getEntityLevel(classItem);
      classesByLevel[level].push(classItem);
      
      classScheduleGrids[classItem.id] = {};
      classAvailability.set(classItem.id, new Set<string>());
      dailyLessonCount.set(classItem.id, new Map<string, Map<string, number>>());
      classWeeklyHours.set(classItem.id, 0); // Sınıf için haftalık ders saati sayacı
      
      // Her sınıfın günlük 9 ders limiti var (Anaokulu hariç)
      classMaxDailyHours.set(classItem.id, 
        getEntityLevel(classItem) === 'Anaokulu' ? 45 : 9 // Her sınıfın günlük 9 ders limiti var
      );
      
      // Her sınıf için ZORUNLU 45 saat hedefi
      classTargetHours.set(classItem.id, 45);
      
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
    const subjectId = mapping.subjectId;
    const classId = mapping.classId;
    const currentTarget = teacherTargetHours.get(teacherId) || 0;
    teacherTargetHours.set(teacherId, currentTarget + mapping.weeklyHours);
    
    // Sınıf-ders renk eşleştirmesi
    const subject = allSubjects.find(s => s.id === subjectId);
    if (subject && classSubjectColors.has(classId)) {
      const colorMap = classSubjectColors.get(classId)!;
      if (!colorMap.has(subjectId)) {
        // Ders için tutarlı bir renk oluştur
        const color = stringToHslColor(subject.name, 85, 90);
        colorMap.set(subjectId, color);
      }
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
    priority: number; // Öncelik değeri: 0 = en yüksek (MUTLAK), 1 = çok yüksek, 5 = normal, 10 = düşük
    classTargetPriority: number; // Sınıf hedef önceliği: Sınıfın 45 saate ne kadar yakın olduğuna göre
    retryCount: number; // Yeniden deneme sayacı
    distributionDay?: number; // Dağıtım şekli için gün indeksi
  };
  
  const allTasks: PlacementTask[] = [];

  // Görevleri oluştur
  mappings.forEach(mapping => {
    let hoursLeft = mapping.weeklyHours;
    if (hoursLeft <= 0) return; // Saat yoksa atla
    
    const classId = mapping.classId;
    const subject = allSubjects.find(s => s.id === mapping.subjectId);
    const isClubSubject = subject && clubSubjectIds.has(subject.id);
    const classItem = allClasses.find(c => c.id === mapping.classId);
    const teacher = allTeachers.find(t => t.id === mapping.teacherId);
    
    // Sınıfın 45 saate ulaşmasını sağla
    const currentClassHours = classWeeklyHours.get(classId) || 0;
    const classAssignedHours = mappings
      .filter(m => m.classId === classId)
      .reduce((sum, m) => sum + m.weeklyHours, 0);
    
    // Sınıfın toplam ders saati 45'ten az ise uyarı ver
    if (classAssignedHours < 45) {
      console.warn(`⚠️ ${classItem?.name || classId} sınıfı için toplam atanan ders saati 45'ten az: ${classAssignedHours} saat`);
    }
    
    // Öncelik değerini belirle
    let priority = 5; // Varsayılan öncelik
    let classTargetPriority = 5; // Varsayılan sınıf hedef önceliği
    
    if (isClubSubject) {
      priority = 2; // Kulüp dersleri için yüksek öncelik
    }
    
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
      const targetClassHours = 45; // Her sınıf için ZORUNLU 45 saat
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
    
    // Dağıtım şekli kontrolü
    let distribution: number[] = [];
    if (subject?.distributionPattern && globalRules.useDistributionPatterns) {
      // Dağıtım şekli varsa kullan
      const parsedDistribution = subjectDistributions.get(subject.id) || [];
      distribution = [...parsedDistribution]; // Kopya oluştur
      if (distribution.length > 0) {
        console.log(`🔄 ${subject.name} dersi için dağıtım şekli kullanılıyor: ${distribution.join('+')}`);
      }
    } else if (mapping.distribution && mapping.distribution.length > 0) {
      distribution = mapping.distribution;
    }
    console.log(`📚 ${subject?.name || 'Bilinmeyen'} dersi için dağıtım: ${distribution.join('+') || 'Yok'}`);
    
    // Dağıtım şekli varsa ve kullanılabilirse, blok olarak yerleştir
    if (distribution.length > 0 && globalRules.useDistributionPatterns) {
        distribution.forEach((block, index) => {
            if (block > 0) {
                allTasks.push(createTask(block, 'dist', index, index));
                hoursLeft -= block;
            }
        });
    }
    
    // Kalan saatleri mümkün olduğunca blok halinde yerleştir
    if (hoursLeft > 0 && globalRules.preferBlockScheduling) {
      // Blok büyüklükleri: 2, 3, 1 (öncelik sırasına göre)
      const blockSizes = [2, 3, 1];
      let remainingHours = hoursLeft;
      let blockIndex = 0;
      
      while (remainingHours > 0) {
        // Mevcut blok büyüklüğü
        const currentBlockSize = blockSizes[blockIndex % blockSizes.length];
        
        // Eğer kalan saat sayısı blok büyüklüğünden az ise, tek saatlik blok oluştur
        if (remainingHours < currentBlockSize) {
          allTasks.push(createTask(1, 'single', blockIndex));
          remainingHours -= 1;
        } 
        // Aksi halde, mevcut blok büyüklüğünde blok oluştur
        else {
          allTasks.push(createTask(currentBlockSize, 'single', blockIndex));
          remainingHours -= currentBlockSize;
        }
        
        blockIndex++;
      }
    } else if (hoursLeft > 0) {
      // Blok yerleştirme tercih edilmiyorsa, tek saatlik görevler oluştur
      for (let i = 0; i < hoursLeft; i++) {
        allTasks.push(createTask(1, 'single', i));
      }
    }
    
    if (hoursLeft < 0) {
      console.warn(`⚠️ ${subject?.name || 'Bilinmeyen ders'} için fazla görev oluşturuldu: ${mapping.weeklyHours} saat yerine ${mapping.weeklyHours - hoursLeft} saat`);
    }
  });
  
  // Görevleri önceliğe göre sırala
  allTasks.sort((a, b) => {
    // 1. Önce önceliğe göre sırala (düşük değer = yüksek öncelik)
    if (a.priority !== b.priority) { 
      return a.priority - b.priority;
    }
    // 2. Sınıf hedef önceliğine göre sırala (45 saate yaklaşan sınıflar önce)
    if (a.classTargetPriority !== b.classTargetPriority) {
      return a.classTargetPriority - b.classTargetPriority;
    }
    // 3. Aynı öncelikte ise blok uzunluğuna göre sırala (uzun bloklar önce)
    return b.blockLength - a.blockLength;
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
      // Ders için renk bilgisi
      const subjectColor = classSubjectColors.get(classId)?.get(subjectId);
      
      classScheduleGrids[classId][day][period] = { 
        subjectId, 
        teacherId, 
        classId,
        color: subjectColor
      };
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
  
  // Yerleştirme istatistikleri
  let placedTasksCount = 0;
  let totalAttempts = 0;
  const maxAttempts = 1000; // Sonsuz döngüyü önlemek için
  
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

      // Sınıf öğretmeni ID'si
      const classTeacherId = classItem.classTeacherId;
      
      // Sınıf öğretmeni mi kontrol et
      const isClassTeacher = (taskTeacherId: string) => classTeacherId === taskTeacherId;
      
      // Önce sınıf öğretmeni derslerini yerleştir
      console.log(`👨‍🏫 ${classItem.name} sınıfı için ${classTeacherTasks.length} sınıf öğretmeni dersi yerleştiriliyor...`);
      
      for (const task of classTeacherTasks) {
        if (task.isPlaced) continue;
        
        const { mapping, blockLength, distributionDay } = task;
        const { teacherId, classId, subjectId } = mapping;
        
        // Sınıf öğretmeni mi kontrol et
        const taskIsClassTeacher = isClassTeacher(teacherId);
        
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
          
          // Günlük limit - her sınıf için 9 ders (Anaokulu hariç)
          const dailyLimit = level === 'Anaokulu' ? 45 : 9;
          
          // Günlük limit aşıldıysa bu günü atla (Anaokulu hariç)
          if (currentDailyCount >= dailyLimit && level !== 'Anaokulu') {
            continue;
          }
          
          // Periyotları sırala - sabah saatlerini önceliklendir
          let periodOrder = [...PERIODS];
          periodOrder.sort((a, b) => {
            const aNum = parseInt(a) || 0;
            const bNum = parseInt(b) || 0;
            if (isNaN(aNum) || isNaN(bNum)) return 0;
            return aNum - bNum; // Küçük sayılar (sabah saatleri) önce
          });
          
          // Blok yerleştirme için tüm olası başlangıç noktalarını dene
          for (let i = 0; i <= periodOrder.length - blockLength; i++) {
            let isAvailable = true;
            const periodsToUse: string[] = [];
            
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
                  classScheduleGrids[classId][day][period] !== null &&
                  classScheduleGrids[classId][day][period] !== undefined) {
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
                
                // Ders için renk bilgisi
                const subjectColor = classSubjectColors.get(classId)?.get(subjectId);
                
                classScheduleGrids[classId][day][period] = { 
                  subjectId, 
                  teacherId, 
                  classId,
                  color: subjectColor
                };
                
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
          totalAttempts++;
          
          // Yeniden deneme sayısını kontrol et
          if (task.retryCount < 100 && totalAttempts < maxAttempts) {
            // Sınıf öğretmeni dersleri için daha fazla deneme
            classTeacherTasks.push(task);
          } else {
            console.warn(`⚠️ Sınıf öğretmeni dersi ${task.retryCount} kez denendi ve yerleştirilemedi: ${classItem.name} - ${subjectId}`);
          }
        }
      }
      
      // Son olarak diğer dersleri yerleştir
      console.log(`📚 ${classItem.name} sınıfı için ${otherClassTasks.length} diğer ders yerleştiriliyor...`);

      // Diğer dersleri öncelik sırasına göre sırala
      otherClassTasks.sort((a, b) => {
        // Önce önceliğe göre sırala
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        
        // Sonra blok uzunluğuna göre sırala (uzun bloklar önce)
        return b.blockLength - a.blockLength;
      });
      
      for (const task of otherClassTasks) {
        if (task.isPlaced) continue;
        
        const { mapping, blockLength, distributionDay } = task;
        const { teacherId, classId, subjectId } = mapping;
        const subject = allSubjects.find(s => s.id === subjectId);
        const taskIsClassTeacher = isClassTeacher(teacherId);
        
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
          
          // Günlük limit - her sınıf için 9 ders (Anaokulu hariç)
          const dailyLimit = level === 'Anaokulu' ? 45 : 9;
          
          // Günlük limit aşıldıysa bu günü atla (Anaokulu hariç)
          if (currentDailyCount >= dailyLimit && level !== 'Anaokulu') {
            continue;
          }
          
          // Periyotları sırala - eğitim seviyesine göre
          let periodOrder = [...PERIODS];
          if (level === 'Anaokulu' || level === 'İlkokul') {
            // Anaokulu ve ilkokul için sabah saatlerini önceliklendir (1, 2, 3, 4...)
            periodOrder.sort((a, b) => {
              const aNum = parseInt(a) || 0;
              const bNum = parseInt(b) || 0;
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
            const periodsToUse: string[] = [];
            
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
                  classScheduleGrids[classId][day][period] !== null &&
                  classScheduleGrids[classId][day][period] !== undefined) {
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
                
                // Ders için renk bilgisi
                const subjectColor = classSubjectColors.get(classId)?.get(subjectId);
                
                classScheduleGrids[classId][day][period] = { 
                  subjectId, 
                  teacherId, 
                  classId,
                  color: subjectColor
                };
                
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
          totalAttempts++;
          
          // Yeniden deneme sayısını kontrol et
          if (task.retryCount < 50 && totalAttempts < maxAttempts) {
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
          teacherSchedules[slot.teacherId][day][period] = { 
            classId: slot.classId, 
            subjectId: slot.subjectId, 
            isFixed: false,
            color: slot.color
          };
        } 
      }); 
    }); 
  });
  
  const finalSchedules = Object.entries(teacherSchedules).map(([teacherId, schedule]) => ({ teacherId, schedule, updatedAt: new Date() }));
  
  // Yerleştirilen ve yerleştirilemeyen dersleri hesapla (istatistikler)
  const placedTasks = allTasks.filter(t => t.isPlaced);
  const placedLessons = placedTasks.reduce((sum, task) => sum + task.blockLength, 0);
  const totalLessonsToPlace = allTasks.reduce((sum, task) => sum + task.blockLength, 0);
  
  // Yerleştirilemeyen dersleri raporla - eğitim seviyesine göre grupla
  
  // Yerleştirilemeyen dersleri raporla
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
        // Blok uzunluğunu ekle
        lesson.missingHours += task.blockLength;
      }
    }
  });

  const unassignedLessons = Array.from(unassignedLessonsMap.values());
  const warnings: string[] = [];
  if (unassignedLessons.length > 0) { 
      const totalMissingHours = unassignedLessons.reduce((sum, l) => sum + l.missingHours, 0); 
      warnings.push(`UYARI: Tüm ders saatleri yerleştirilemedi. ${unassignedLessons.length} ders (${totalMissingHours} saat) yerleştirilemedi.`);
      
      // Yerleştirilemeyen dersleri eğitim seviyesi ve sınıf öğretmeni önceliğine göre sırala
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
      const targetHours = 45; // ZORUNLU 45 saat
      const percentage = Math.round(hours/targetHours*100);
      console.log(`${classItem.name}: ${hours}/${targetHours} saat (${percentage}%) - ${targetHours - hours} saat eksik`);
      if (hours < targetHours) {
        // Her sınıf için 45 saat zorunlu olduğundan, eksik olan her sınıf için uyarı göster
        warnings.push(`${classItem.name} sınıfı için haftalık ders saati 45'in altında: ${hours} saat (${percentage}%)`);
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
  console.log(`📊 Yerleştirilen görev sayısı: ${placedTasksCount}/${allTasks.length} (${Math.round(placedTasksCount/allTasks.length*100)}%)`); 
  
  // 45 saat hedefine ulaşmayan sınıfları raporla
  const classesBelow45Hours = Array.from(classWeeklyHours.entries())
    .filter(([_, hours]) => hours < 45)
    .map(([classId, hours]) => {
      const classItem = allClasses.find(c => c.id === classId);
      return {
        className: classItem?.name || classId,
        hours,
        percentage: Math.round((hours / 45) * 100)
      };
    });
  
  if (classesBelow45Hours.length > 0) {
    console.warn('⚠️ 45 saat hedefine ulaşmayan sınıflar:');
    classesBelow45Hours.forEach(c => {
      console.warn(`${c.className}: ${c.hours}/45 saat (${c.percentage}%)`);
      warnings.push(`KRİTİK: ${c.className} sınıfı 45 saat zorunluluğunu karşılamıyor: ${c.hours} saat (${c.percentage}%)`);
    });
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