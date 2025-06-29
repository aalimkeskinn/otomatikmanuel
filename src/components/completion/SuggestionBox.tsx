// --- START OF FILE src/components/completion/SuggestionBox.tsx ---
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, ExternalLink } from 'lucide-react';
import { SwapSuggestion } from '../../utils/scheduleAnalyzer';
import Button from '../UI/Button';

interface SuggestionBoxProps {
  suggestions: SwapSuggestion[];
}

const SuggestionBox: React.FC<SuggestionBoxProps> = ({ suggestions }) => {
    const navigate = useNavigate();

    const handleSuggestionClick = (suggestion: SwapSuggestion) => {
        alert(`Öneri: ${suggestion.targetClass.name} sınıfının ${suggestion.day} ${suggestion.period}. saatindeki ${suggestion.targetSubject.name} dersini, yerleştirmeye çalıştığınız dersle takas etmeyi deneyin.`);
        navigate(`/schedules?mode=teacher&teacherId=${suggestion.targetTeacher.id}`);
    };

    if (suggestions.length === 0) {
        return (
            <div className="p-3 bg-gray-50 border rounded-lg mt-3 text-center">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Lightbulb className="w-4 h-4 text-gray-400" />
                </div>
                <h4 className="font-medium text-gray-700 text-xs mb-1">Otomatik Öneri Bulunamadı</h4>
                <p className="text-xs text-gray-500">
                    Bu dersi yerleştirmek için uygun bir takas bulunamadı.
                </p>
            </div>
        );
    }

    return (
        <div className="p-3 bg-blue-50 border-l-3 border-blue-500 mt-3 rounded-r-lg">
            <div className="flex">
                <div className="flex-shrink-0">
                    <Lightbulb className="h-4 w-4 text-blue-600" />
                </div>
                <div className="ml-2 w-full">
                    <h3 className="text-xs font-medium text-blue-800 mb-1">Çözüm Önerileri</h3>
                    <p className="text-xs text-blue-700 mb-2">
                        Aşağıdaki derslerden birini farklı bir saate taşıyarak yer açabilirsiniz:
                    </p>
                    <div className="space-y-2">
                        {suggestions.map((s, index) => (
                        <div key={index} className="p-2 bg-white rounded-lg border border-blue-200 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className='flex-1 text-xs'>
                                    <div className="flex items-center mb-1">
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                            {s.day} {s.period}. saat
                                        </span>
                                    </div>
                                    <p className="font-medium text-gray-800">
                                        <strong className="text-blue-700">{s.targetSubject.name}</strong> ({s.targetClass.name})
                                    </p>
                                    <p className="text-xs text-gray-600">
                                        {s.targetTeacher.name}
                                    </p>
                                </div>
                                <Button 
                                    size="sm"
                                    icon={ExternalLink}
                                    variant="secondary"
                                    onClick={() => handleSuggestionClick(s)}
                                    className="flex-shrink-0 ml-2"
                                >
                                    Aç
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