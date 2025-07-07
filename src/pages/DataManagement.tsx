import React, { useState, useRef } from 'react';
import { 
  Database, 
  Users, 
  Building, 
  BookOpen, 
  Calendar, 
  Trash2, 
  AlertTriangle,
  BarChart3,
  Settings,
  Download,
  Upload,
  MapPin,
  HeartPulse, // Yeni ikon
  CheckCircle, // Yeni ikon
  XCircle // Yeni ikon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFirestore } from '../hooks/useFirestore';
import { useToast } from '../hooks/useToast';
import { useConfirmation } from '../hooks/useConfirmation';
import { Teacher, Class, Subject, Schedule, TeacherAssignment } from '../types';
import { parseComprehensiveCSV } from '../utils/csvParser';
import Button from '../components/UI/Button';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import Modal from '../components/UI/Modal';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';

// Interfaces
interface ScheduleTemplate { id: string; name: string; }
interface Classroom { id: string; name: string; }
interface ParsedDataState {
  teachers: Map<string, Partial<Teacher>>;
  classes: Map<string, Partial<Class & { tempAssignments: Map<string, Set<string>>, classTeacherName: string | null }>>;
  subjects: Map<string, Partial<Subject>>;
  classSubjectTeacherLinks: { className: string, subjectKey: string, teacherName: string }[];
  errors: string[];
}

const downloadCSV = (content: string, fileName: string) => {
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const DataManagement = () => {
  const navigate = useNavigate();
  const { data: teachers } = useFirestore<Teacher>('teachers');
  const { data: classes } = useFirestore<Class>('classes');
  const { data: subjects } = useFirestore<Subject>('subjects');
  const { data: schedules } = useFirestore<Schedule>('schedules');
  const { data: templates } = useFirestore<ScheduleTemplate>('schedule-templates');
  const { data: classrooms } = useFirestore<Classroom>('classrooms');
  const { success, error, warning, info } = useToast();
  const { confirmation, hideConfirmation, confirmDelete } = useConfirmation();

  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const comprehensiveFileInputRef = useRef<HTMLInputElement>(null);
  const [isComprehensiveCSVModalOpen, setIsComprehensiveCSVModalOpen] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedDataState | null>(null);
  const [parsingErrors, setParsingErrors] = useState<string[]>([]);
  const [isImportingAll, setIsImportingAll] = useState(false);
  
  // YENİ: Veri sağlığı kontrolü için state
  const [healthCheckResults, setHealthCheckResults] = useState<{ overbookedTeachers: { name: string; totalHours: number }[] }>({ overbookedTeachers: [] });
  const [isHealthCheckModalOpen, setIsHealthCheckModalOpen] = useState(false);
  const [isAnalyzingData, setIsAnalyzingData] = useState(false);

  // YENİ: Veri Sağlığı Kontrolü Fonksiyonu
  const runDataHealthCheck = () => {
    setIsAnalyzingData(true);
    info("Veri Analizi Başlatıldı", "Sistem verileri analiz ediliyor...");
    
    const teacherHours = new Map<string, number>();
    const classHours = new Map<string, number>();
    const classTeacherAssignments = new Map<string, Set<string>>();
    const subjectDistributions = new Map<string, boolean>();

    // Sınıflardaki atamalardan öğretmenlerin toplam saatini hesapla
    classes.forEach(c => {
      let classTotal = 0;
      
      // Sınıf öğretmeni kontrolü
      if (c.classTeacherId) {
        if (!classTeacherAssignments.has(c.id)) {
          classTeacherAssignments.set(c.id, new Set());
        }
        classTeacherAssignments.get(c.id)!.add(c.classTeacherId);
      }
      
      c.assignments?.forEach(assignment => {
        const teacherId = assignment.teacherId;
        assignment.subjectIds.forEach(subjectId => {
          const subject = subjects.find(s => s.id === subjectId);
          if (subject) {
            // Öğretmen saatleri
            const currentHours = teacherHours.get(teacherId) || 0;
            teacherHours.set(teacherId, currentHours + subject.weeklyHours);
            
            // Sınıf saatleri
            classTotal += subject.weeklyHours;
            
            // Dağıtım şekli kontrolü
            if (subject.distributionPattern) {
              subjectDistributions.set(subject.id, true);
            }
            
            // Sınıf öğretmeni atama kontrolü
            if (c.classTeacherId === teacherId) {
              classTeacherAssignments.get(c.id)!.add(teacherId);
            }
          }
        });
      });
      
      // Sınıf toplam saati
      classHours.set(c.id, classTotal);
    });

    // Analiz sonuçları
    const overbookedTeachers: { name: string; totalHours: number; overBy: number }[] = [];
    const underloadedClasses: { name: string; totalHours: number; underBy: number }[] = [];
    const overloadedClasses: { name: string; totalHours: number; overBy: number }[] = [];
    const classesWithoutTeachers: { name: string }[] = [];
    const classesWithoutClassTeacher: { name: string }[] = [];
    
    // Öğretmen yük analizi
    teacherHours.forEach((totalHours, teacherId) => {
      if (totalHours > 45) { // Haftalık 45 saat limiti
        const teacher = teachers.find(t => t.id === teacherId);
        if (teacher) {
          overbookedTeachers.push({ 
            name: teacher.name, 
            totalHours,
            overBy: totalHours - 45
          });
        }
      }
    });
    
    // Sınıf ders saati analizi
    classHours.forEach((totalHours, classId) => {
      const classItem = classes.find(c => c.id === classId);
      if (!classItem) return;
      
      if (totalHours < 45) {
        underloadedClasses.push({
          name: classItem.name,
          totalHours,
          underBy: 45 - totalHours
        });
      } else if (totalHours > 45) {
        overloadedClasses.push({
          name: classItem.name,
          totalHours,
          overBy: totalHours - 45
        });
      }
      
      // Sınıf öğretmeni kontrolü
      if (!classItem.classTeacherId) {
        classesWithoutClassTeacher.push({ name: classItem.name });
      }
      
      // Öğretmen ataması kontrolü
      if (!classItem.assignments || classItem.assignments.length === 0) {
        classesWithoutTeachers.push({ name: classItem.name });
      }
    });
    
    // Sonuçları state'e kaydet
    setHealthCheckResults({ 
      overbookedTeachers,
      underloadedClasses,
      overloadedClasses,
      classesWithoutTeachers,
      classesWithoutClassTeacher,
      subjectDistributions: Array.from(subjectDistributions.entries())
    });
    
    // Analiz tamamlandı
    setIsAnalyzingData(false);
    
    // Sonuçları göster
    if (overbookedTeachers.length === 0 && 
        underloadedClasses.length === 0 && 
        overloadedClasses.length === 0 && 
        classesWithoutTeachers.length === 0) {
      success("✅ Veri Sağlığı İyi", "Sistem verilerinde önemli bir sorun tespit edilmedi.");
    } else {
      let problemCount = 0;
      if (overbookedTeachers.length > 0) problemCount += overbookedTeachers.length;
      if (underloadedClasses.length > 0) problemCount += underloadedClasses.length;
      if (overloadedClasses.length > 0) problemCount += overloadedClasses.length;
      if (classesWithoutTeachers.length > 0) problemCount += classesWithoutTeachers.length;
      
      warning("⚠️ Veri Sorunları Tespit Edildi", `${problemCount} potansiyel sorun tespit edildi. Detaylar için sonuçları inceleyin.`);
    }
    
    setIsHealthCheckModalOpen(true);
  };

  // Veri sağlığı sonuçlarını göster
  const renderHealthCheckResults = () => {
    const { 
      overbookedTeachers, 
      underloadedClasses, 
      overloadedClasses,
      classesWithoutTeachers,
      classesWithoutClassTeacher
    } = healthCheckResults;
    
    const hasProblems = overbookedTeachers?.length > 0 || 
                       underloadedClasses?.length > 0 || 
                       overloadedClasses?.length > 0 || 
                       classesWithoutTeachers?.length > 0 ||
                       classesWithoutClassTeacher?.length > 0;
    
    if (!hasProblems) {
      return (
        <div className="text-center p-6">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Her Şey Yolunda!</h3>
          <p className="text-gray-600 mt-2">Sistem verilerinde önemli bir sorun tespit edilmedi. Program oluşturmaya hazırsınız.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Aşırı yüklü öğretmenler */}
        {overbookedTeachers?.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-red-800 flex items-center">
              <XCircle className="w-5 h-5 mr-2 text-red-600" />
              Aşırı Yüklü Öğretmenler ({overbookedTeachers.length})
            </h3>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700 mb-3">
                Aşağıdaki öğretmenlerin haftalık ders yükleri 45 saati aşıyor. Bu durum program oluşturmayı imkansız hale getirebilir.
              </p>
              <ul className="divide-y divide-red-200">
                {overbookedTeachers.map(teacher => (
                  <li key={teacher.name} className="py-2 flex justify-between items-center">
                    <span className="font-medium">{teacher.name}</span>
                    <div className="flex items-center">
                      <span className="bg-red-100 text-red-800 text-sm font-semibold px-3 py-1 rounded-full">
                        {teacher.totalHours} saat
                      </span>
                      <span className="ml-2 text-xs text-red-600">
                        (+{teacher.overBy})
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        {/* Eksik ders saati olan sınıflar */}
        {underloadedClasses?.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-orange-800 flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-orange-600" />
              Eksik Ders Saati Olan Sınıflar ({underloadedClasses.length})
            </h3>
            <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-sm text-orange-700 mb-3">
                Aşağıdaki sınıfların haftalık ders saatleri 45'in altında. Her sınıf için 45 saat zorunludur.
              </p>
              <ul className="divide-y divide-orange-200">
                {underloadedClasses.map(cls => (
                  <li key={cls.name} className="py-2 flex justify-between items-center">
                    <span className="font-medium">{cls.name}</span>
                    <div className="flex items-center">
                      <span className="bg-orange-100 text-orange-800 text-sm font-semibold px-3 py-1 rounded-full">
                        {cls.totalHours} saat
                      </span>
                      <span className="ml-2 text-xs text-orange-600">
                        (-{cls.underBy})
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        {/* Fazla ders saati olan sınıflar */}
        {overloadedClasses?.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-yellow-800 flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-yellow-600" />
              Fazla Ders Saati Olan Sınıflar ({overloadedClasses.length})
            </h3>
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-700 mb-3">
                Aşağıdaki sınıfların haftalık ders saatleri 45'in üzerinde. Bu durum program oluşturmayı zorlaştırabilir.
              </p>
              <ul className="divide-y divide-yellow-200">
                {overloadedClasses.map(cls => (
                  <li key={cls.name} className="py-2 flex justify-between items-center">
                    <span className="font-medium">{cls.name}</span>
                    <div className="flex items-center">
                      <span className="bg-yellow-100 text-yellow-800 text-sm font-semibold px-3 py-1 rounded-full">
                        {cls.totalHours} saat
                      </span>
                      <span className="ml-2 text-xs text-yellow-600">
                        (+{cls.overBy})
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        {/* Öğretmen ataması olmayan sınıflar */}
        {classesWithoutTeachers?.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-red-800 flex items-center">
              <XCircle className="w-5 h-5 mr-2 text-red-600" />
              Öğretmen Ataması Olmayan Sınıflar ({classesWithoutTeachers.length})
            </h3>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700 mb-3">
                Aşağıdaki sınıflara hiç öğretmen ataması yapılmamış. Bu sınıflar için program oluşturulamaz.
              </p>
              <ul className="divide-y divide-red-200">
                {classesWithoutTeachers.map(cls => (
                  <li key={cls.name} className="py-2">
                    <span className="font-medium">{cls.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        {/* Sınıf öğretmeni olmayan sınıflar */}
        {classesWithoutClassTeacher?.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-yellow-800 flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-yellow-600" />
              Sınıf Öğretmeni Olmayan Sınıflar ({classesWithoutClassTeacher.length})
            </h3>
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-700 mb-3">
                Aşağıdaki sınıfların sınıf öğretmeni atanmamış. Bu durum program oluşturmayı etkilemez ancak sınıf yönetimi için önemlidir.
              </p>
              <ul className="divide-y divide-yellow-200">
                {classesWithoutClassTeacher.map(cls => (
                  <li key={cls.name} className="py-2">
                    <span className="font-medium">{cls.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  };


  const handleComprehensiveCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) { error('❌ Dosya Hatası', 'Dosya içeriği okunamadı'); return; }
      try {
        const result = parseComprehensiveCSV(content);
        setParsedData(result);
        setParsingErrors(result.errors);
        setIsComprehensiveCSVModalOpen(true);
      } catch (err) {
        console.error('Kapsamlı CSV işleme hatası:', err);
        error('❌ CSV Hatası', 'Dosya işlenirken beklenmedik bir hata oluştu.');
      } finally {
        if (comprehensiveFileInputRef.current) comprehensiveFileInputRef.current.value = '';
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleDownloadCSVTemplate = () => {
    const templateContent = `öğretmen adı;branş;eğitim seviyesi;ders Adı;sınıf ve şube;haftalık saat\n"Öğretmen 1";"SINIF ÖĞRETMENLİĞİ";"İLKOKUL";"TÜRKÇE";"1A";"10"\n"Öğretmen 1";"SINIF ÖĞRETMENLİĞİ";"İLKOKUL";"MATEMATİK";"1A";"5"`;
    downloadCSV(templateContent, 'kapsamli_veri_sablonu.csv');
    success('✅ Şablon İndirildi', 'CSV şablonu başarıyla indirildi');
  };
  
  const handleImportAllData = async () => {
    if (!parsedData) return;
    setIsImportingAll(true);
    info('Veri aktarımı başladı...', 'Lütfen bekleyin.');
  
    const { teachers: newTeachersMap, classes: newClassesMap, subjects: newSubjectsMap, classSubjectTeacherLinks } = parsedData;
    
    try {
        const teacherIdMap = new Map<string, string>(teachers.map(t => [t.name, t.id]));
        const classIdMap = new Map<string, string>(classes.map(c => [c.name, c.id]));
        const subjectKeyToIdMap = new Map<string, string>();
        const firstBatch = writeBatch(db);

        for (const [key, subjectData] of newSubjectsMap.entries()) {
            const docRef = doc(collection(db, "subjects"));
            firstBatch.set(docRef, { ...subjectData, createdAt: new Date() });
            subjectKeyToIdMap.set(key, docRef.id);
        }
        await firstBatch.commit();
        console.log('✅ Adım 1/3: Yeni Dersler Firestore\'a yazıldı.');

        const teacherToSubjectIds = new Map<string, Set<string>>();
        for (const link of classSubjectTeacherLinks) {
            const subjectId = subjectKeyToIdMap.get(link.subjectKey);
            if (subjectId) {
                if (!teacherToSubjectIds.has(link.teacherName)) {
                    teacherToSubjectIds.set(link.teacherName, new Set());
                }
                teacherToSubjectIds.get(link.teacherName)!.add(subjectId);
            }
        }
        console.log('✅ Adım 2/3: Öğretmen-Ders ilişkileri hafızada oluşturuldu.');

        const secondBatch = writeBatch(db);

        for (const [name, teacherData] of newTeachersMap.entries()) {
            if (!teacherIdMap.has(name)) {
                const subjectIds = Array.from(teacherToSubjectIds.get(name) || []);
                const docRef = doc(collection(db, "teachers"));
                secondBatch.set(docRef, { ...teacherData, subjectIds, createdAt: new Date() });
                teacherIdMap.set(name, docRef.id);
            }
        }

        for (const [className, classData] of newClassesMap.entries()) {
            const assignmentsByTeacher = new Map<string, Set<string>>();
            classSubjectTeacherLinks.filter(link => link.className === className).forEach(link => {
                const teacherId = teacherIdMap.get(link.teacherName);
                const subjectId = subjectKeyToIdMap.get(link.subjectKey);
                if (teacherId && subjectId) {
                  if (!assignmentsByTeacher.has(teacherId)) {
                    assignmentsByTeacher.set(teacherId, new Set());
                  }
                  assignmentsByTeacher.get(teacherId)!.add(subjectId);
                }
            });

            const finalAssignments: TeacherAssignment[] = Array.from(assignmentsByTeacher.entries()).map(([teacherId, subjectIds]) => ({
              teacherId,
              subjectIds: Array.from(subjectIds),
            }));

            const finalClassData: Omit<Class, "id"> = {
                name: classData.name!,
                level: classData.level!,
                levels: classData.levels!,
                assignments: finalAssignments,
                classTeacherId: classData.classTeacherName ? (teacherIdMap.get(classData.classTeacherName) || "") : "",
                teacherIds: Array.from(new Set(finalAssignments.map(a => a.teacherId))),
                createdAt: new Date()
            };
            
            const existingClassId = classIdMap.get(className);
            const ref = existingClassId ? doc(db, "classes", existingClassId) : doc(collection(db, "classes"));
            secondBatch.set(ref, finalClassData, { merge: true });
        }
        
        await secondBatch.commit();
        console.log('✅ Adım 3/3: Yeni Öğretmenler ve Sınıflar başarıyla yazıldı/güncellendi.');

        success('✅ Aktarım Tamamlandı!', `Veriler başarıyla içe aktarıldı.`);
    } catch (err: any) {
        error('❌ Aktarım Hatası', err.message);
        console.error(err);
    } finally {
        setIsImportingAll(false);
        setIsComprehensiveCSVModalOpen(false);
    }
  };

  const handleDeleteAllData = () => {
    const allData = [
      { name: 'teachers', data: teachers },
      { name: 'classes', data: classes },
      { name: 'subjects', data: subjects },
      { name: 'schedules', data: schedules },
      { name: 'schedule-templates', data: templates },
      { name: 'classrooms', data: classrooms },
    ];
    const totalItemCount = allData.reduce((sum, item) => sum + item.data.length, 0);
    if (totalItemCount === 0) {
      warning('⚠️ Silinecek Veri Yok', 'Sistemde silinecek herhangi bir veri bulunamadı.');
      return;
    }
    confirmDelete(`Tüm Sistem Verileri (${totalItemCount} öğe)`, async () => {
      setIsDeletingAll(true);
      info('Tüm veriler siliniyor...', 'Bu işlem biraz zaman alabilir.');
      try {
        const batch = writeBatch(db);
        allData.forEach(collectionData => {
          collectionData.data.forEach(item => {
            const docRef = doc(db, collectionData.name, item.id);
            batch.delete(docRef);
          });
        });
        await batch.commit();
        success('🗑️ Tüm Veriler Silindi', `${totalItemCount} veri öğesi sistemden başarıyla kaldırıldı.`);
      } catch (err) {
        console.error('❌ Toplu silme hatası:', err);
        error('❌ Toplu Silme Hatası', 'Tüm veriler silinirken bir hata oluştu. Lütfen konsolu kontrol edin.');
      } finally {
        setIsDeletingAll(false);
      }
    });
  };
  
  const totalDataCount = teachers.length + classes.length + subjects.length + schedules.length + templates.length + classrooms.length;
  const dataCards = [
    { title: 'Öğretmenler', count: teachers.length, icon: Users, color: 'blue', path: '/teachers' },
    { title: 'Sınıflar', count: classes.length, icon: Building, color: 'emerald', path: '/classes' },
    { title: 'Dersler', count: subjects.length, icon: BookOpen, color: 'indigo', path: '/subjects' },
    { title: 'Derslikler', count: classrooms.length, icon: MapPin, color: 'teal', path: '/classrooms' },
    { title: 'Programlar', count: schedules.length, icon: Calendar, color: 'purple', path: '/all-schedules' },
    { title: 'Şablonlar', count: templates.length, icon: Settings, color: 'orange', path: '/' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
            <div className="flex items-center">
                <Database className="w-8 h-8 text-purple-600 mr-3" />
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Veri Yönetimi</h1>
                    <p className="text-sm text-gray-600">Sistem verilerini yönetin ve temizleyin</p>
                </div>
            </div>
            <Button onClick={() => navigate('/')} variant="secondary">Ana Sayfaya Dön</Button>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-4"><Upload className="w-6 h-6 text-blue-500 mr-3" /><h2 className="text-lg font-bold text-gray-900">Akıllı Veri Yükleme</h2></div>
            <p className="text-sm text-gray-600 mb-4">Verilen CSV şablonunu tek seferde yükleyerek tüm öğretmen, sınıf ve ders verilerini sisteme otomatik olarak ekleyin.</p>
            <div className="flex items-center space-x-3">
              <input type="file" accept=".csv" onChange={handleComprehensiveCSVUpload} ref={comprehensiveFileInputRef} className="hidden" id="comprehensive-csv-upload" />
              <Button onClick={() => comprehensiveFileInputRef.current?.click()} icon={Upload} variant="primary">Kapsamlı CSV Yükle</Button>
              <Button onClick={handleDownloadCSVTemplate} icon={Download} variant="secondary">Şablon İndir</Button>
            </div>
          </div>
          {/* YENİ: Veri Sağlığı Kontrolü Kartı */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-4"><HeartPulse className="w-6 h-6 text-green-500 mr-3" /><h2 className="text-lg font-bold text-gray-900">Veri Sağlığı Kontrolü</h2></div>
            <p className="text-sm text-gray-600 mb-4">Program oluşturmadan önce, öğretmenlerin ders yükleri gibi olası mantık hatalarını kontrol edin.</p>
            <Button 
              onClick={runDataHealthCheck} 
              icon={HeartPulse} 
              variant="secondary" 
              className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
              disabled={isAnalyzingData}
            >
              {isAnalyzingData ? "Analiz Ediliyor..." : "Veri Sağlığını Kontrol Et"}
            </Button>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
            <div className="flex items-center justify-between mb-6"><div className="flex items-center"><BarChart3 className="w-6 h-6 text-purple-600 mr-2" /><h2 className="text-lg font-bold text-gray-900">Veri İstatistikleri</h2></div><div className="text-sm text-gray-600">Toplam {totalDataCount} veri öğesi</div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
                {dataCards.map(card => {
                    const colorClasses = {
                        bg: `bg-${card.color}-50`,
                        border: `border-${card.color}-100`,
                        icon: `text-${card.color}-600`,
                        title: `text-${card.color}-900`,
                        count: `text-${card.color}-700`,
                    };
                    return (
                        <div key={card.title} className={`${colorClasses.bg} rounded-xl p-4 border ${colorClasses.border} flex flex-col items-center justify-between min-h-[180px] shadow-sm`}>
                            <div className="flex flex-col items-center text-center">
                                <card.icon className={`w-8 h-8 ${colorClasses.icon} mb-2`} />
                                <h3 className={`font-semibold ${colorClasses.title}`}>{card.title}</h3>
                            </div>
                            <span className={`text-4xl font-extrabold ${colorClasses.count} my-2`}>{card.count}</span>
                            <Button onClick={() => navigate(card.path)} variant="secondary" size="sm" className="w-full mt-auto">Yönet</Button>
                        </div>
                    )
                })}
            </div>
        </div>

        <div className="bg-red-50 rounded-lg shadow-sm border border-red-200 p-6">
          <div className="flex items-center mb-4"><AlertTriangle className="w-6 h-6 text-red-600 mr-2" /><h2 className="text-lg font-bold text-red-900">Tehlikeli Bölge</h2></div>
          <div className="p-4 bg-white rounded-lg border border-red-100"><div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div><h3 className="font-medium text-red-900">Tüm Verileri Sil</h3><p className="text-sm text-red-700 mt-1">Bu işlem tüm verileri kalıcı olarak silecektir. Bu işlem geri alınamaz!</p></div><Button onClick={handleDeleteAllData} icon={Trash2} variant="danger" disabled={isDeletingAll || totalDataCount === 0} className="w-full sm:w-auto flex-shrink-0">{isDeletingAll ? 'Siliniyor...' : `Tüm Verileri Sil (${totalDataCount})`}</Button></div></div>
        </div>
      </div>

      <Modal isOpen={isComprehensiveCSVModalOpen} onClose={() => setIsComprehensiveCSVModalOpen(false)} title="Kapsamlı Veri İçe Aktarma Önizlemesi" size="xl">
        <div className="space-y-6">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <h4 className="font-medium text-green-800 mb-2">Ayrıştırma Sonucu</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div><p className="text-2xl font-bold text-green-700">{parsedData?.teachers.size || 0}</p><p className="text-sm text-green-600">Benzersiz Öğretmen</p></div>
              <div><p className="text-2xl font-bold text-green-700">{parsedData?.classes.size || 0}</p><p className="text-sm text-green-600">Benzersiz Sınıf</p></div>
              <div><p className="text-2xl font-bold text-green-700">{parsedData?.subjects.size || 0}</p><p className="text-sm text-green-600">Benzersiz Ders</p></div>
            </div>
          </div>
          {parsingErrors.length > 0 && (
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <h4 className="font-medium text-red-800 mb-2">Tespit Edilen Hatalar ({parsingErrors.length})</h4>
              <ul className="list-disc list-inside text-sm text-red-700 max-h-40 overflow-y-auto">{parsingErrors.map((err, i) => <li key={i}>{err}</li>)}</ul>
            </div>
          )}
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" onClick={() => setIsComprehensiveCSVModalOpen(false)} variant="secondary">İptal</Button>
            <Button type="button" onClick={handleImportAllData} variant="primary" disabled={isImportingAll}>
              {isImportingAll ? 'Aktarılıyor...' : 'Verileri İçe Aktar'}
            </Button>
          </div>
        </div>
      </Modal>
      
      {/* YENİ: Veri Sağlığı Kontrolü Modalı */}
      <Modal isOpen={isHealthCheckModalOpen} onClose={() => setIsHealthCheckModalOpen(false)} title="Veri Sağlığı Kontrol Sonuçları">
        {renderHealthCheckResults()}
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setIsHealthCheckModalOpen(false)} variant="primary">Kapat</Button>
        </div>
      </Modal>

      <ConfirmationModal isOpen={confirmation.isOpen} onClose={hideConfirmation} onConfirm={confirmation.onConfirm} title={confirmation.title} message={confirmation.message} type={confirmation.type} confirmText={confirmation.confirmText} cancelText={confirmation.cancelText} confirmVariant={confirmation.confirmVariant} />
    </div>
  );
};

export default DataManagement;