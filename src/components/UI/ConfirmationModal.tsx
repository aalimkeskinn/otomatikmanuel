import React from 'react';
import { AlertTriangle, CheckCircle, XCircle, Info, X } from 'lucide-react';
import Button from './Button';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  type?: 'warning' | 'danger' | 'success' | 'info';
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger' | 'secondary' | 'success' | 'warning' | 'info';
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type = 'warning',
  confirmText = 'Onayla',
  cancelText = 'İptal',
  confirmVariant = 'primary'
}) => {
  if (!isOpen) return null;

  const icons = {
    warning: AlertTriangle,
    danger: XCircle,
    success: CheckCircle,
    info: Info
  };

  const colors = {
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-300',
      icon: 'text-yellow-600',
      title: 'text-yellow-900'
    },
    danger: {
      bg: 'bg-red-50',
      border: 'border-red-300',
      icon: 'text-red-600',
      title: 'text-red-900'
    },
    success: {
      bg: 'bg-green-50',
      border: 'border-green-300',
      icon: 'text-green-600',
      title: 'text-green-900'
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-300',
      icon: 'text-blue-600',
      title: 'text-blue-900'
    }
  };

  const Icon = icons[type];
  const colorScheme = colors[type];

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-900 bg-opacity-75 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
        
        {/* Center modal */}
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        
        {/* Modal panel */}
        <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full mx-4 sm:mx-0">
          {/* Header */}
          <div className={`${colorScheme.bg} ${colorScheme.border} border-b px-6 pt-6 pb-4`}>
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${type === 'danger' ? 'bg-red-100' : type === 'warning' ? 'bg-yellow-100' : type === 'success' ? 'bg-green-100' : 'bg-blue-100'}`}>
                  <Icon className={`h-6 w-6 ${colorScheme.icon}`} />
                </div>
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-bold ${colorScheme.title}`}>
                  {title}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200"
                aria-label="Modalı kapat"
              >
                <X size={20} />
              </button>
            </div>
          </div>
          
          {/* Content */}
          <div className="bg-white px-6 py-5">
            <div className="text-gray-700 text-sm leading-relaxed whitespace-pre-line">
              {message}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-6 py-3 flex justify-end space-x-3">
            <Button
              onClick={onClose}
              variant="secondary"
              size="sm"
            >
              {cancelText}
            </Button>
            <Button
              onClick={handleConfirm}
              variant={confirmVariant}
              size="sm"
            >
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;