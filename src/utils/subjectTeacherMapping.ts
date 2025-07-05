// --- START OF FILE src/utils/subjectTeacherMapping.ts ---

import { Teacher, Class, Subject, parseDistributionPattern } from '../types';
import { WizardData, SubjectTeacherMapping } from '../types/wizard';

function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

// Kulüp derslerini tespit et
function isClubSubject(subject: Subject): boolean {
  return subject.name.toLowerCase().includes('kulüp');
}

export function createSubjectTeacherMappings(
  wizardData: WizardData,
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[]
): { mappings: SubjectTeacherMapping[], errors: string[] } {
  
  const mappings: SubjectTeacherMapping[] = [];
  const errors: string[] = [];

  const selectedClassIds = new Set(wizardData.classes.selectedClasses);
  const selectedSubjectIds = new Set(wizardData.subjects.selectedSubjects);
  const selectedTeacherIds = new Set(wizardData.teachers.selectedTeachers);

  // Kulüp derslerini tespit et
  const clubSubjectIds = new Set<string>();
  allSubjects.forEach(subject => {
    if (isClubSubject(subject)) {
      clubSubjectIds.add(subject.id);
      console.log(`🎭 Kulüp dersi tespit edildi: ${subject.name}`);
    }
  });

  // Sınıf-öğretmen-ders eşleştirmelerini kontrol et
  console.log('🔍 Eşleştirme başlatılıyor:', {
    selectedClasses: selectedClassIds.size,
    selectedSubjects: selectedSubjectIds.size,
    selectedTeachers: selectedTeacherIds.size
  });

  // Her sınıf için atama kontrolü
  for (const classId of selectedClassIds) {
    const classItem = allClasses.find(c => c.id === classId);
    if (!classItem) {
      console.warn(`⚠️ Sınıf bulunamadı: ${classId}`);
      continue;
    }
    
    console.log(`🏫 Sınıf işleniyor: ${classItem.name}`, {
      assignments: classItem.assignments?.length || 0
    });
    
    // Sınıfın atamalarını kontrol et
    if (!classItem.assignments || classItem.assignments.length === 0) {
      errors.push(`${classItem.name} sınıfına hiç öğretmen ataması yapılmamış.`);
      continue;
    }

    // Her atama için
    for (const assignment of classItem.assignments) {
      const teacherId = assignment.teacherId;
      const teacher = allTeachers.find(t => t.id === teacherId);

      // Öğretmen seçilmiş mi kontrol et
      if (!selectedTeacherIds.has(teacherId) || !teacher) {
        console.warn(`⚠️ Öğretmen seçilmemiş veya bulunamadı: ${teacherId}`);
        continue;
      }
      
      console.log(`👨‍🏫 Öğretmen işleniyor: ${teacher.name}`, {
        subjectIds: assignment.subjectIds.length
      });
      
      // Seviye uyumluluğunu kontrol et
      const teacherLevels = new Set(teacher.levels || [teacher.level]);
      const classLevel = getEntityLevel(classItem);
      if (!teacherLevels.has(classLevel)) {
          errors.push(`UYARI: ${teacher.name} (${[...teacherLevels].join(', ')}) öğretmeni, ${classItem.name} (${classLevel}) sınıfının seviyesiyle uyumsuz. Bu atama yoksayıldı.`);
          continue;
      }

      // Her ders için
      for (const subjectId of assignment.subjectIds) {
        // Ders seçilmiş mi kontrol et
        if (!selectedSubjectIds.has(subjectId)) {
          console.warn(`⚠️ Ders seçilmemiş: ${subjectId}`);
          continue;
        }
        
        const subject = allSubjects.find(s => s.id === subjectId);
        if (!subject) {
          console.warn(`⚠️ Ders bulunamadı: ${subjectId}`);
          continue;
        }
        
        console.log(`📚 Ders işleniyor: ${subject.name}`, {
          weeklyHours: subject.weeklyHours,
          distributionPattern: subject.distributionPattern
        });
        
        // Aynı eşleştirme daha önce eklendiyse atla
        const mappingExists = mappings.some(m => 
          m.classId === classId && m.subjectId === subjectId
        );
        
        if (!mappingExists) {
          // Haftalık ders saati
          const weeklyHours = wizardData.subjects.subjectHours[subjectId] || subject.weeklyHours;
          
          // Dağıtım şekli
          const distribution = subject.distributionPattern
            ? parseDistributionPattern(subject.distributionPattern) 
            : undefined;
          
          // Kulüp dersi mi kontrol et
          const isClub = clubSubjectIds.has(subjectId);

          // Eşleştirme oluştur
          const task: SubjectTeacherMapping = {
            id: `${classId}-${subjectId}`, 
            classId, 
            subjectId, 
            teacherId, 
            weeklyHours,
            assignedHours: 0, 
            distribution, 
            priority: isClub ? 'high' : 'medium', // Kulüp dersleri için yüksek öncelik
          };

          // Dağıtım şekli kontrolü
          if (distribution && distribution.reduce((a, b) => a + b, 0) !== weeklyHours) {
            errors.push(`UYARI: ${classItem.name} > ${subject.name} dersinin dağıtım şekli (${subject.distributionPattern}) haftalık saatle (${weeklyHours}) uyuşmuyor. Ders 1'er saatlik bloklar halinde yerleştirilecek.`);
            delete task.distribution;
          }
          
          mappings.push(task);
          console.log(`✅ Eşleştirme eklendi: ${classItem.name} - ${subject.name} - ${teacher.name}`);
        }
      }
    }
  }
  
  console.log(`📊 Eşleştirme sonuçları:`, {
    mappingsCount: mappings.length,
    errorsCount: errors.length,
    clubSubjectsCount: Array.from(clubSubjectIds).length
  });
  
  if (mappings.length === 0 && selectedSubjectIds.size > 0) {
    errors.push("Hiçbir geçerli ders ataması bulunamadı. Lütfen 'Sınıflar' ekranından öğretmenlere ders atadığınızdan ve sihirbazda ilgili tüm (sınıf, öğretmen, ders) öğeleri seçtiğinizden emin olun.");
  }

  return { mappings, errors };
}

// --- END OF FILE src/utils/subjectTeacherMapping.ts ---