// --- START OF FILE src/components/completion/SuggestionBox.tsx ---
import React from 'react';
import { Lightbulb } from 'lucide-react';

interface SuggestionBoxProps {
  conflictReasons: Map<string, string[]>;
  onSuggestionClick: (suggestionType: string) => void;
}

const SuggestionBox: React.FC<SuggestionBoxProps> = ({ conflictReasons, onSuggestionClick }) => {
  // Basit bir analiz: En çok hangi tür çakışma var?
  const teacherBusyCount = [...conflictReasons.values()].filter(r => r.includes("Öğretmen bu saatte başka bir derste.")).length;
  const classBusyCount = [...conflictReasons.values()].filter(r => r.includes("Sınıf bu saatte başka bir derste.")).length;
  const teacherConstraintCount = [...conflictReasons.values()].filter(r => r.some(s => s.startsWith("Öğretmen kısıtlaması"))).length;

  const suggestions = [];
  if(teacherBusyCount > 20) {
      suggestions.push({ type: 'teacher_schedule', text: 'Öğretmenin programı çok dolu görünüyor. Öğretmenin diğer derslerinden birini kaydırmayı deneyin.' });
  }
  if(teacherConstraintCount > 10) {
      suggestions.push({ type: 'teacher_constraint', text: 'Öğretmenin zaman kısıtlamaları yerleşimi engelliyor olabilir. Kısıtlamalarını gözden geçirin.' });
  }

  if(suggestions.length === 0) return null;

  return (
    <div className="p-4 bg-ide-primary-50 border-l-4 border-ide-primary-500 mt-6">
      <div className="flex">
        <div className="flex-shrink-0"><Lightbulb className="h-5 w-5 text-ide-primary-600" /></div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-ide-primary-800">Çözüm Önerileri</h3>
          <div className="mt-2 text-sm text-ide-primary-700">
            <ul className="list-disc list-inside space-y-1">
              {suggestions.map(s => <li key={s.type}><button onClick={() => onSuggestionClick(s.type)} className="underline hover:text-ide-primary-900">{s.text}</button></li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SuggestionBox;
// --- END OF FILE src/components/completion/SuggestionBox.tsx ---