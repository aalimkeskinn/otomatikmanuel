// --- START OF FILE src/types/wizard.ts ---

import { Schedule } from './index'; // Projenizdeki ana type dosyasından import
import { TimeConstraint } from './constraints'; // Projenizdeki constraints dosyasından import

/**
 * Sihirbaz boyunca toplanan tüm verileri tutan ana arayüz.
 */
export interface WizardData {
  basicInfo: {
    name: string;
    academicYear: string;
    semester: string;
    startDate: string;
    endDate: string;
    description: string;
    institutionTitle: string;
    dailyHours: number;
    weekDays: number;
    weekendClasses: boolean;
  };
  subjects: {
    selectedSubjects: string[];
    subjectHours: { [subjectId: string]: number };
    subjectPriorities: { [subjectId: string]: 'high' | 'medium' | 'low' };
  };
  classes: {
    selectedClasses: string[];
    classCapacities: { [classId: string]: number };
    classPreferences: { [classId: string]: string[] };
  };
  classrooms: any[];
  teachers: {
    selectedTeachers: string[];
    teacherSubjects: { [teacherId: string]: string[] };
    teacherMaxHours: { [teacherId: string]: number };
    teacherPreferences: { [teacherId: string]: string[] };
  };
  constraints: {
    timeConstraints: TimeConstraint[];
    globalRules: {
      maxDailyHoursTeacher: number;
      maxDailyHoursClass: number;
      maxConsecutiveHours: number;
      avoidConsecutiveSameSubject: boolean;
      preferMorningHours: boolean;
      avoidFirstLastPeriod: boolean;
      lunchBreakRequired: boolean;
      lunchBreakDuration: number;
      useDistributionPatterns?: boolean;
      preferBlockScheduling?: boolean;
      enforceDistributionPatterns?: boolean;
      maximumBlockSize?: number;
    };
  };
  generationSettings: {
    algorithm: 'balanced' | 'compact' | 'distributed';
    prioritizeTeacherPreferences: boolean;
    prioritizeClassPreferences: boolean;
    allowOverlaps: boolean;
    generateMultipleOptions: boolean;
    optimizationLevel: 'fast' | 'balanced' | 'thorough';
  };
}


/**
 * Program oluşturma algoritmasının "görev listesi"
 */
export interface SubjectTeacherMapping {
  id: string; 
  classId: string;
  subjectId: string;
  teacherId: string;
  weeklyHours: number; 
  assignedHours: number;
  distribution?: number[];
  priority: 'high' | 'medium' | 'low';
}

/**
 * Sihirbaz tarafından yerleştirilemeyen bir dersin detayları
 */
export interface UnassignedLesson {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  missingHours: number;
  totalHours: number;
}

/**
 * Program oluşturma işlemi tamamlandığında dönecek olan sonuç yapısı.
 */
export interface EnhancedGenerationResult {
  success: boolean;
  schedules: Omit<Schedule, 'id' | 'createdAt'>[];
  statistics: {
    totalLessonsToPlace: number;
    placedLessons: number;
    unassignedLessons: UnassignedLesson[]; // GÜNCELLENDİ
  };
  warnings: string[];
  errors: string[];
}


/**
 * Sihirbaz durumunu bir şablon olarak kaydetmek için kullanılan arayüz.
 */
export interface ScheduleTemplate {
  id: string;
  name: string;
  description: string;
  academicYear: string;
  semester: string;
  updatedAt: Date;
  wizardData: WizardData;
  generatedSchedules: any[];
  status: 'draft' | 'published' | 'archived';
}

// --- END OF FILE src/types/wizard.ts ---