// --- START OF FILE src/components/completion/SuggestionBox.tsx ---
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, Repeat, ExternalLink } from 'lucide-react';
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
            <div className="p-5 bg-ide-gray-50 border rounded-xl mt-6 text-center">
                <div className="w-12 h-12 bg-ide-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Lightbulb className="w-6 h-6 text-ide-gray-400" />
                </div>
                <h4 className="font-medium text-ide-gray-800 mb-1">Otomatik Öneri Bulunamadı</h4>
                <p className="text-sm text-ide-gray-600 mt-1 max-w-lg mx-auto">
                    Bu dersi yerleştirmek için uygun bir takas bulunamadı. Lütfen kısıtlamaları veya diğer derslerin yerlerini manuel olarak kontrol edin.
                </p>
            </div>
        );
    }

    return (
        <div className="p-5 bg-ide-primary-50 border-l-4 border-ide-primary-500 mt-6 rounded-r-xl shadow-sm">
            <div className="flex">
                <div className="flex-shrink-0">
                    <Lightbulb className="h-6 w-6 text-ide-primary-600 mt-1" />
                </div>
                <div className="ml-4 w-full">
                    <h3 className="text-lg font-semibold text-ide-primary-900 mb-1">Çözüm Önerileri</h3>
                    <p className="text-sm text-ide-primary-700 mb-4">
                        Aşağıdaki derslerden birini farklı bir saate taşıyarak yer açmayı deneyebilirsiniz:
                    </p>
                    <div className="space-y-4">
                        {suggestions.map((s, index) => (
                        <div key={index} className="p-4 bg-white rounded-xl border border-ide-primary-200 shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-center justify-between">
                                <div className='flex-1'>
                                    <div className="flex items-center mb-2">
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-ide-accent-100 text-ide-accent-800 border border-ide-accent-200">
                                            {s.day} {s.period}. saat
                                        </span>
                                    </div>
                                    <p className="font-semibold text-ide-gray-800 text-base mb-1">
                                        <strong className="text-ide-primary-700">{s.targetSubject.name}</strong> dersi ({s.targetClass.name} sınıfı)
                                    </p>
                                    <p className="text-sm text-ide-gray-600">
                                        Öğretmen: {s.targetTeacher.name}
                                    </p>
                                </div>
                                <Button 
                                    size="sm"
                                    icon={ExternalLink}
                                    variant="ide-primary"
                                    onClick={() => handleSuggestionClick(s)}
                                    className="flex-shrink-0 ml-4"
                                >
                                    Programı Aç
                                </Button>
                            </div>
                        </div>
                        ))}
                    </div>
                    <p className="text-xs text-ide-primary-600 mt-3">
                        * Bu dersleri manuel programdan boş bir saate taşıyarak yer açabilirsiniz.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SuggestionBox;
// --- END OF FILE src/components/completion/SuggestionBox.tsx ---