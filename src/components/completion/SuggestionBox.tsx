// --- START OF FILE src/components/completion/SuggestionBox.tsx ---
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, Repeat } from 'lucide-react';
import { SwapSuggestion } from '../../utils/scheduleAnalyzer';
import Button from '../UI/Button';

interface SuggestionBoxProps {
  suggestions: SwapSuggestion[];
}

const SuggestionBox: React.FC<SuggestionBoxProps> = ({ suggestions }) => {
    const navigate = useNavigate();

    const handleSuggestionClick = (suggestion: SwapSuggestion) => {
        alert(`Öneri: ${suggestion.targetClass.name} sınıfının ${suggestion.day} ${suggestion.period}. saatindeki ${suggestion.targetSubject.name} dersini, yerleştirmeye çalıştığınız dersle takas etmeyi deneyin. Bu dersi manuel programdan boş bir saate taşıyarak bu alanı açabilirsiniz.`);
        navigate(`/schedules?mode=teacher&teacherId=${suggestion.targetTeacher.id}`);
    };

    if (suggestions.length === 0) {
        return (
            <div className="p-4 bg-gray-100 border rounded-lg mt-6 text-center">
                <h4 className="font-medium text-gray-700">Otomatik Öneri Bulunamadı</h4>
                <p className="text-sm text-gray-500 mt-1">Bu dersi yerleştirmek için uygun bir takas bulunamadı. Lütfen kısıtlamaları veya diğer derslerin yerlerini manuel olarak kontrol edin.</p>
            </div>
        );
    }

    return (
        <div className="p-4 bg-ide-primary-50 border-l-4 border-ide-primary-500 mt-6 rounded-r-lg">
            <div className="flex">
                <div className="flex-shrink-0"><Lightbulb className="h-5 w-5 text-ide-primary-600 mt-1" /></div>
                <div className="ml-3 w-full">
                    <h3 className="text-sm font-medium text-ide-primary-800">Çözüm Önerileri</h3>
                    <p className="text-xs text-ide-primary-700 mb-3">Aşağıdaki derslerden birini farklı bir saate taşıyarak yer açmayı deneyebilirsiniz:</p>
                    <div className="space-y-3">
                        {suggestions.map((s, index) => (
                        <div key={index} className="p-3 bg-white rounded-lg border border-ide-primary-200 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className='flex-1 text-sm'>
                                    <p>
                                        <strong className="text-red-600">{s.day} {s.period}. saatteki</strong>
                                    </p>
                                    <p className="font-semibold text-gray-800">
                                        <strong className="text-indigo-600">{s.targetSubject.name}</strong> dersini ({s.targetClass.name} sınıfı)
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        Öğretmen: {s.targetTeacher.name}
                                    </p>
                                </div>
                                <Button 
                                    size="sm"
                                    icon={Repeat}
                                    variant="secondary"
                                    onClick={() => handleSuggestionClick(s)}
                                    className="flex-shrink-0 ml-4"
                                >
                                    Dersi Taşı
                                </Button>
                            </div>
                        </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SuggestionBox;
// --- END OF FILE src/components/completion/SuggestionBox.tsx ---