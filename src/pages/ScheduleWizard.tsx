// --- START OF FILE src/pages/ScheduleWizard.tsx ---

import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Zap,
  Play,
  Check,
  Home,
  BookOpen,
  Building,
  Users,
  Calendar,
  Eye,
  Database,
  MapPin,
  Settings,
  Save
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useFirestore } from '../hooks/useFirestore';
import { useToast } from '../hooks/useToast';
import Button from '../components/UI/Button';
import WizardStepBasicInfo from '../components/Wizard/WizardStepBasicInfo';
import WizardStepSubjects from '../components/Wizard/WizardStepSubjects';
import WizardStepClasses from '../components/Wizard/WizardStepClasses';
import WizardStepClassrooms from '../components/Wizard/WizardStepClassrooms';
import WizardStepTeachers from '../components/Wizard/WizardStepTeachers';
import WizardStepConstraints from '../components/Wizard/WizardStepConstraints';
import WizardStepGeneration from '../components/Wizard/WizardStepGeneration';
import { Teacher, Class, Subject, Schedule } from '../types';
import { TimeConstraint } from '../types/constraints';
import { createSubjectTeacherMappings } from '../utils/subjectTeacherMapping';
import { generateSystematicSchedule } from '../utils/scheduleGeneration';
import { WizardData, ScheduleTemplate, EnhancedGenerationResult } from '../types/wizard';

const WIZARD_STEPS = [
  { id: 'basic-info', title: 'Temel Bilgiler', description: 'Program adı ve dönem', icon: Home },
  { id: 'subjects', title: 'Dersler', description: 'Ders seçimi ve saatleri', icon: BookOpen },
  { id: 'classes', title: 'Sınıflar', description: 'Sınıf seçimi ve özellikleri', icon: Building },
  { id: 'classrooms', title: 'Derslikler', description: 'Derslik yönetimi', icon: MapPin },
  { id: 'teachers', title: 'Öğretmenler', description: 'Öğretmen seçimi ve dersleri', icon: Users },
  { id: 'constraints', title: 'Kısıtlamalar', description: 'Zaman kuralları', icon: Calendar },
  { id: 'generation', title: 'Program Oluştur', description: 'Otomatik oluşturma', icon: Zap }
];

const ScheduleWizard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: teachers } = useFirestore<Teacher>('teachers');
  const { data: classes } = useFirestore<Class>('classes');
  const { data: subjects } = useFirestore<Subject>('subjects');
  const { add: addTemplate, update: updateTemplate, data: templates } = useFirestore<ScheduleTemplate>('schedule-templates');
  const { add: addSchedule, data: existingSchedules, remove: removeSchedule } = useFirestore<Schedule>('schedules');
  const { data: constraintsFromDB } = useFirestore<TimeConstraint>('constraints');
  const { success, error, warning, info } = useToast();

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [wizardData, setWizardData] = useState<WizardData>({
    basicInfo: { name: '', academicYear: '2024/2025', semester: '', startDate: '2024-09-01', endDate: '2025-08-31', description: '', institutionTitle: '', dailyHours: 10, weekDays: 5, weekendClasses: false },
    subjects: { selectedSubjects: [], subjectHours: {}, subjectPriorities: {} },
    classes: { selectedClasses: [], classCapacities: {}, classPreferences: {} },
    classrooms: [],
    teachers: { selectedTeachers: [], teacherSubjects: {}, teacherMaxHours: {}, teacherPreferences: {} },
    constraints: { 
      timeConstraints: [], 
      globalRules: { maxDailyHoursTeacher: 8, maxDailyHoursClass: 9, maxConsecutiveHours: 3, avoidConsecutiveSameSubject: true, preferMorningHours: true, avoidFirstLastPeriod: false, lunchBreakRequired: true, lunchBreakDuration: 1, useDistributionPatterns: true, preferBlockScheduling: true, enforceDistributionPatterns: false, maximumBlockSize: 2 } 
    },
    generationSettings: { algorithm: 'balanced', prioritizeTeacherPreferences: true, prioritizeClassPreferences: true, allowOverlaps: false, generateMultipleOptions: true, optimizationLevel: 'balanced' }
  });

  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState<EnhancedGenerationResult | null>(null);

  // Load existing template data
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const templateId = urlParams.get('templateId');
    if (templateId && templates.length > 0) {
      const template = templates.find(t => t.id === templateId);
      if (template && template.wizardData) {
        setEditingTemplateId(templateId);
        setWizardData(template.wizardData);
        const newCompletedSteps = new Set<number>();
        if (template.wizardData.basicInfo?.name) newCompletedSteps.add(0);
        if (template.wizardData.subjects?.selectedSubjects?.length > 0) newCompletedSteps.add(1);
        if (template.wizardData.classes?.selectedClasses?.length > 0) newCompletedSteps.add(2);
        if (template.wizardData.classrooms?.length > 0) newCompletedSteps.add(3);
        if (template.wizardData.teachers?.selectedTeachers?.length > 0) newCompletedSteps.add(4);
        setCompletedSteps(newCompletedSteps);
      }
    }
  }, [location.search, templates]);
  
  const onSelectedTeachersChange = (selectedTeacherIds: string[]) => {
    setWizardData(prev => ({...prev, teachers: { ...prev.teachers, selectedTeachers: selectedTeacherIds }}));
  };

  const currentStep = WIZARD_STEPS[currentStepIndex];
  const validateCurrentStep = (): boolean => {
    switch (currentStep.id) {
      case 'basic-info': return !!(wizardData.basicInfo.name && wizardData.basicInfo.academicYear);
      case 'subjects': return wizardData.subjects.selectedSubjects.length > 0;
      case 'classes': return wizardData.classes.selectedClasses.length > 0;
      case 'teachers': return wizardData.teachers.selectedTeachers.length > 0;
      default: return true;
    }
  };
  
  const handleNext = () => { if (validateCurrentStep()) { setCompletedSteps(prev => new Set([...prev, currentStepIndex])); if (currentStepIndex < WIZARD_STEPS.length - 1) { setCurrentStepIndex(currentStepIndex + 1); } } else { warning('⚠️ Eksik Bilgi', 'Lütfen gerekli alanları doldurun'); } };
  const handlePrevious = () => { if (currentStepIndex > 0) { setCurrentStepIndex(currentStepIndex - 1); } };
  const handleStepClick = (index: number) => {
    if (completedSteps.has(index) || index <= currentStepIndex) {
      setCurrentStepIndex(index);
    }
  };
  
  const updateWizardData = (stepId: keyof WizardData, stepData: any) => {
    setWizardData(prev => ({ ...prev, [stepId]: stepData }));
  };
  
  const handleSaveTemplate = async () => {
    if (!wizardData.basicInfo.name) { warning('⚠️ Program Adı Gerekli', 'Lütfen program adını girin'); return; }
    setIsSaving(true);
    try {
      const templateData: Omit<ScheduleTemplate, 'id'> = { name: wizardData.basicInfo.name, description: wizardData.basicInfo.description, academicYear: wizardData.basicInfo.academicYear, semester: wizardData.basicInfo.semester, updatedAt: new Date(), wizardData, status: 'draft' as const, generatedSchedules: [] };
      if (editingTemplateId) {
        await updateTemplate(editingTemplateId, templateData);
        success('✅ Şablon Güncellendi', `'${templateData.name}' başarıyla güncellendi`);
      } else {
        const result = await addTemplate(templateData);
        if (result.success && result.id) {
            setEditingTemplateId(result.id);
            navigate(`/schedule-wizard?templateId=${result.id}`, { replace: true });
            success('✅ Şablon Kaydedildi', `'${templateData.name}' başarıyla kaydedildi`);
        } else {
            throw new Error(result.error || "Şablon eklenirken bilinmeyen bir hata oluştu.");
        }
      }
    } catch (err: any) { error('❌ Kayıt Hatası', `Şablon kaydedilirken bir hata oluştu: ${err.message}`); } finally { setIsSaving(false); }
  };

  const handleGenerateSchedule = async () => {
    if (isGenerating) return;
    info("Program oluşturma başlatılıyor...", "Veriler kontrol ediliyor ve görevler oluşturuluyor.");
    setIsGenerating(true);
    setGenerationResult(null);

    try {
      const { mappings, errors: mappingErrors } = createSubjectTeacherMappings(wizardData, teachers, classes, subjects);
      if (mappingErrors.length > 0) {
        error("Planlama Hatası", `Program oluşturulamadı:\n- ${mappingErrors.join('\n- ')}`);
        setIsGenerating(false); return;
      }
      if (mappings.length === 0) {
        error("Eşleştirme Hatası", "Hiçbir ders-öğretmen-sınıf eşleştirmesi yapılamadı. Lütfen seçimlerinizi kontrol edin.");
        setIsGenerating(false); return;
      }
      const result = generateSystematicSchedule(mappings, teachers, classes, subjects, wizardData.constraints?.timeConstraints || [], wizardData.constraints.globalRules);
      
      if (!result || !result.schedules) {
          error("Oluşturma Hatası", "Algoritma beklenmedik bir sonuç döndürdü.");
          setIsGenerating(false); return;
      }

      const teacherIdsInNewSchedule = new Set(result.schedules.map(s => s.teacherId));
      const schedulesToDelete = existingSchedules.filter(s => teacherIdsInNewSchedule.has(s.teacherId));
      for (const schedule of schedulesToDelete) { await removeSchedule(schedule.id); }
      for (const schedule of result.schedules) { await addSchedule(schedule as Omit<Schedule, 'id' | 'createdAt'>); }
      
      const { unassignedLessons, placedLessons, totalLessonsToPlace } = result.statistics;
      
      if (unassignedLessons.length > 0) {
        warning("Eksik Dersler Mevcut", `${totalLessonsToPlace} dersten ${unassignedLessons.length} tanesi yerleştirilemedi. Lütfen eksikleri tamamlayın.`);
      } else {
        success('🎉 Program Başarıyla Oluşturuldu!', `${result.schedules.length} öğretmen için program güncellendi.`);
      }

      await handleSaveTemplate();
      setGenerationResult(result);

    } catch (err: any) {
      error("Kritik Hata", `Beklenmedik bir hata oluştu: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep.id) {
      case 'basic-info': return <WizardStepBasicInfo data={wizardData.basicInfo} onUpdate={(data) => updateWizardData('basicInfo', data)} />;
      case 'subjects': return <WizardStepSubjects data={wizardData.subjects} onUpdate={(data) => updateWizardData('subjects', data)} />;
      case 'classes': return <WizardStepClasses data={wizardData} onUpdate={(data) => updateWizardData('classes', data.classes)} classes={classes} />;
      case 'classrooms': return <WizardStepClassrooms data={wizardData} onUpdate={(data) => updateWizardData('classrooms', data.classrooms)} />;
      case 'teachers': return <WizardStepTeachers selectedTeachers={wizardData.teachers.selectedTeachers} onSelectedTeachersChange={onSelectedTeachersChange} wizardData={wizardData} all_classes={classes} />;
      case 'constraints': return <WizardStepConstraints data={wizardData} onUpdate={(data) => updateWizardData('constraints', data.constraints)} teachers={teachers} classes={classes} subjects={subjects} />;
      case 'generation': return <WizardStepGeneration data={wizardData.generationSettings} wizardData={wizardData} onUpdate={(data) => updateWizardData('generationSettings', data)} onGenerate={handleGenerateSchedule} isGenerating={isGenerating} teachers={teachers} classes={classes} subjects={subjects} />;
      default: return <div>Bilinmeyen adım</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
       <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center"><Zap className="w-8 h-8 text-blue-600 mr-3" /><div><h1 className="text-xl font-bold text-gray-900">{editingTemplateId ? 'Program Düzenleme' : 'Program Oluşturma Sihirbazı'}</h1><p className="text-sm text-gray-600">{`Adım ${currentStepIndex + 1}: ${currentStep.title}`}</p></div></div>
            <div className="flex items-center space-x-3">
              <Button onClick={handleSaveTemplate} icon={Save} variant="secondary" disabled={isSaving || !wizardData.basicInfo.name}>{isSaving ? 'Kaydediliyor...' : 'Şablonu Kaydet'}</Button>
              <Button onClick={() => navigate('/')} variant="secondary">İptal</Button>
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Adımlar</h3>
              <div className="space-y-2">
                {WIZARD_STEPS.map((step, index) => {
                  const Icon = step.icon as React.ElementType; // Icon'u bir component olarak kullanmak için
                  const isCompleted = completedSteps.has(index);
                  const isCurrent = index === currentStepIndex;
                  const isAccessible = completedSteps.has(index) || isCurrent || completedSteps.has(index - 1) || index === 0;
                  return (
                    <button 
                      key={step.id} 
                      onClick={() => handleStepClick(index)} 
                      disabled={!isAccessible}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-300 transform hover:scale-[1.02] ${isCurrent ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-400 shadow-lg ring-2 ring-blue-200' : isCompleted ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-300 hover:border-green-400 shadow-md' : isAccessible ? 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm' : 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed opacity-60'}`}
                    >
                      <div className="flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm transition-all ${isCurrent ? 'bg-gradient-to-r from-blue-500 to-indigo-500 shadow-lg' : isCompleted ? 'bg-gradient-to-r from-green-500 to-emerald-500 shadow-md' : isAccessible ? 'bg-gradient-to-r from-gray-400 to-gray-500' : 'bg-gray-300'}`}>
                          {isCompleted ? <Check size={20} /> : <span>{index + 1}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold text-sm ${isCurrent ? 'text-blue-700' : isCompleted ? 'text-green-700' : isAccessible ? 'text-gray-700' : 'text-gray-400'}`}>{step.title}</p>
                          <p className={`text-xs mt-1 ${isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : isAccessible ? 'text-gray-500' : 'text-gray-400'}`}>{step.description}</p>
                        </div>
                        {isCurrent && <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-6">{renderStepContent()}</div>
              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between">
                  <Button onClick={handlePrevious} icon={ChevronLeft} variant="secondary" disabled={currentStepIndex === 0}>Önceki</Button>
                  {currentStepIndex < WIZARD_STEPS.length - 1 ? (
                    <Button onClick={handleNext} icon={ChevronRight} variant="primary" disabled={!validateCurrentStep()}>Sonraki</Button>
                  ) : (
                    <Button onClick={handleGenerateSchedule} icon={Play} variant="primary" disabled={!validateCurrentStep() || isGenerating} size="lg">
                      {isGenerating ? 'Program Oluşturuluyor...' : 'Program Oluştur ve Kaydet'}
                    </Button>
                  )}
                </div>

                {/* Sonuç ve Yönlendirme Bölümü */}
                {generationResult && (
                  <div className="mt-6 p-4 border rounded-lg bg-gray-100 animate-professional-fade">
                    <h4 className="font-bold text-gray-800">Oluşturma Raporu</h4>
                    <p className="text-sm text-gray-600 mt-2">
                      Toplam {generationResult.statistics.totalLessonsToPlace} ders saatinden 
                      <strong className="text-green-600 mx-1">{generationResult.statistics.placedLessons}</strong> tanesi başarıyla yerleştirildi.
                    </p>
                    {generationResult.statistics.unassignedLessons.length > 0 && (
                      <div className="mt-4">
                        <p className="text-sm text-red-600 font-semibold">
                          {generationResult.statistics.unassignedLessons.length} ders yerleştirilemedi.
                        </p>
                        <Button 
                          className="mt-2"
                          variant="primary"
                          onClick={() => navigate('/schedule-completion', { state: { unassignedLessons: generationResult.statistics.unassignedLessons } })}
                        >
                          Eksik Dersleri Manuel Tamamla
                        </Button>
                      </div>
                    )}
                    {generationResult.statistics.unassignedLessons.length === 0 && (
                       <Button 
                        className="mt-4"
                        variant="primary"
                        onClick={() => navigate('/all-schedules')}
                      >
                        Tüm Programları Görüntüle
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleWizard;
// --- END OF FILE src/pages/ScheduleWizard.tsx ---