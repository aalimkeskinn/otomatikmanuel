import React, { useState, useEffect } from 'react';
import { Zap, Settings, AlertTriangle, CheckCircle, Clock, Hourglass, Lightbulb, Play } from 'lucide-react';
import { WizardData } from '../../types/wizard';
import { Teacher, Class, Subject } from '../../types';
import Button from '../UI/Button';
import Select from '../UI/Select';

interface WizardStepGenerationProps {
  data: WizardData['generationSettings'];
  wizardData: WizardData;
  onUpdate: (data: WizardData['generationSettings']) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  teachers: Teacher[];
  classes: Class[];
  subjects: Subject[];
}

const WizardStepGeneration: React.FC<WizardStepGenerationProps> = ({
  data,
  wizardData,
  onUpdate,
  onGenerate,
  isGenerating,
  teachers,
  classes,
  subjects
}) => {
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Validate wizard data
  useEffect(() => {
    const messages: string[] = [];
    
    // Check if we have selected teachers, classes, and subjects
    if (wizardData.teachers.selectedTeachers.length === 0) {
      messages.push('Hiç öğretmen seçilmemiş');
    }
    
    if (wizardData.classes.selectedClasses.length === 0) {
      messages.push('Hiç sınıf seçilmemiş');
    }
    
    if (wizardData.subjects.selectedSubjects.length === 0) {
      messages.push('Hiç ders seçilmemiş');
    }
    
    // Check if classes have teacher assignments
    const classesWithoutAssignments = classes
      .filter(c => wizardData.classes.selectedClasses.includes(c.id))
      .filter(c => !c.assignments || c.assignments.length === 0);
    
    if (classesWithoutAssignments.length > 0) {
      messages.push(`${classesWithoutAssignments.length} sınıfın öğretmen ataması yok`);
    }
    
    // Check if we have any time constraints
    if (wizardData.constraints.timeConstraints.length === 0) {
      messages.push('Hiç zaman kısıtlaması tanımlanmamış (opsiyonel)');
    }
    
    setValidationMessages(messages);
    setIsReady(messages.length === 0 || (messages.length === 1 && messages[0].includes('kısıtlaması')));
  }, [wizardData, classes]);

  const handleChange = (field: keyof WizardData['generationSettings'], value: any) => {
    onUpdate({
      ...data,
      [field]: value
    });
  };

  const algorithmOptions = [
    { value: 'balanced', label: 'Dengeli (Önerilen)' },
    { value: 'compact', label: 'Sıkışık (Boşluk Az)' },
    { value: 'distributed', label: 'Dağıtılmış (Boşluk Çok)' }
  ];

  const optimizationOptions = [
    { value: 'fast', label: 'Hızlı (Daha Az Optimizasyon)' },
    { value: 'balanced', label: 'Dengeli (Önerilen)' },
    { value: 'thorough', label: 'Detaylı (Daha Fazla Optimizasyon)' }
  ];

  // Calculate statistics
  const selectedTeachersCount = wizardData.teachers.selectedTeachers.length;
  const selectedClassesCount = wizardData.classes.selectedClasses.length;
  const selectedSubjectsCount = wizardData.subjects.selectedSubjects.length;
  
  // Calculate total weekly hours
  const totalWeeklyHours = Object.entries(wizardData.subjects.subjectHours).reduce((total, [subjectId, hours]) => {
    if (wizardData.subjects.selectedSubjects.includes(subjectId)) {
      return total + hours;
    }
    return total;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Zap className="w-12 h-12 text-orange-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Program Oluşturma</h2>
        <p className="text-gray-600">
          Otomatik program oluşturma ayarlarını yapın ve programı oluşturun
        </p>
      </div>

      {/* Validation Messages */}
      {validationMessages.length > 0 && (
        <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded-r-lg">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">Dikkat Edilmesi Gerekenler</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <ul className="list-disc pl-5 space-y-1">
                  {validationMessages.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <div className="flex items-center justify-between">
            <div className="text-blue-800 font-medium">Öğretmenler</div>
            <div className="text-2xl font-bold text-blue-600">{selectedTeachersCount}</div>
          </div>
        </div>
        <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
          <div className="flex items-center justify-between">
            <div className="text-emerald-800 font-medium">Sınıflar</div>
            <div className="text-2xl font-bold text-emerald-600">{selectedClassesCount}</div>
          </div>
        </div>
        <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
          <div className="flex items-center justify-between">
            <div className="text-indigo-800 font-medium">Dersler</div>
            <div className="text-2xl font-bold text-indigo-600">{selectedSubjectsCount}</div>
          </div>
        </div>
        <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
          <div className="flex items-center justify-between">
            <div className="text-purple-800 font-medium">Haftalık Saat</div>
            <div className="text-2xl font-bold text-purple-600">{totalWeeklyHours}</div>
          </div>
        </div>
      </div>

      {/* Algorithm Settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center mb-4">
          <Settings className="w-5 h-5 text-gray-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Algoritma Ayarları</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Select
            label="Algoritma Tipi"
            value={data.algorithm}
            onChange={(value) => handleChange('algorithm', value)}
            options={algorithmOptions}
          />
          
          <Select
            label="Optimizasyon Seviyesi"
            value={data.optimizationLevel}
            onChange={(value) => handleChange('optimizationLevel', value)}
            options={optimizationOptions}
          />
        </div>
        
        <div className="mt-6 space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="prioritizeTeacherPreferences"
              checked={data.prioritizeTeacherPreferences}
              onChange={(e) => handleChange('prioritizeTeacherPreferences', e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="prioritizeTeacherPreferences" className="ml-2 text-sm font-medium text-gray-700">
              Öğretmen tercihlerini önceliklendir
            </label>
          </div>
          
          <div className="flex items-center">
            <input
              type="checkbox"
              id="prioritizeClassPreferences"
              checked={data.prioritizeClassPreferences}
              onChange={(e) => handleChange('prioritizeClassPreferences', e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="prioritizeClassPreferences" className="ml-2 text-sm font-medium text-gray-700">
              Sınıf tercihlerini önceliklendir
            </label>
          </div>
          
          <div className="flex items-center">
            <input
              type="checkbox"
              id="generateMultipleOptions"
              checked={data.generateMultipleOptions}
              onChange={(e) => handleChange('generateMultipleOptions', e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="generateMultipleOptions" className="ml-2 text-sm font-medium text-gray-700">
              Birden fazla seçenek oluştur
            </label>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-lg">
        <div className="flex">
          <div className="flex-shrink-0">
            <Lightbulb className="h-5 w-5 text-blue-400" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">İpuçları</h3>
            <div className="mt-2 text-sm text-blue-700">
              <ul className="list-disc pl-5 space-y-1">
                <li>Dengeli algoritma, çoğu durumda en iyi sonucu verir</li>
                <li>Öğretmen tercihleri, sınıf tercihlerinden daha önceliklidir</li>
                <li>Optimizasyon seviyesi arttıkça işlem süresi uzar</li>
                <li>Çok fazla kısıtlama, uygun bir program oluşturmayı zorlaştırabilir</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="flex justify-center mt-8">
        <Button
          onClick={onGenerate}
          icon={isGenerating ? Hourglass : Play}
          variant="primary"
          size="lg"
          disabled={isGenerating || !isReady}
          className="px-8 py-4 text-lg"
        >
          {isGenerating ? 'Program Oluşturuluyor...' : 'Programı Oluştur'}
        </Button>
      </div>

      {/* Processing Status */}
      {isGenerating && (
        <div className="text-center mt-4">
          <div className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-full">
            <Clock className="animate-spin h-5 w-5 mr-2" />
            <span>İşleniyor... Lütfen bekleyin</span>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Bu işlem, veri miktarına bağlı olarak birkaç saniye sürebilir
          </p>
        </div>
      )}
    </div>
  );
};

export default WizardStepGeneration;