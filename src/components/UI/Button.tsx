import React from 'react';
import { DivideIcon as LucideIcon } from 'lucide-react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ide-primary' | 'ide-secondary' | 'ide-accent' | 'ide-orange' | 'success' | 'warning' | 'info';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  icon?: LucideIcon;
  className?: string;
}

const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  icon: Icon,
  className = ''
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none transform hover:scale-[1.02] active:scale-[0.98] focus-enhanced';
  
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm hover:shadow-md',
    secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 focus:ring-gray-500 border border-gray-300 hover:border-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm hover:shadow-md',
    // İDE kurumsal renkleri
    'ide-primary': 'btn-ide-primary',
    'ide-secondary': 'btn-ide-secondary', 
    'ide-accent': 'btn-ide-accent',
    'ide-orange': 'btn-ide-orange',
    // Durum renkleri
    'success': 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500 shadow-sm hover:shadow-md',
    'warning': 'bg-yellow-500 text-white hover:bg-yellow-600 focus:ring-yellow-400 shadow-sm hover:shadow-md',
    'info': 'bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-400 shadow-sm hover:shadow-md'
  };
  
  const sizes = {
    sm: 'px-4 py-2.5 text-sm min-h-[44px] btn-touch', // Daha kompakt
    md: 'px-5 py-3 text-sm min-h-[48px] btn-touch',   // Standart
    lg: 'px-6 py-4 text-base min-h-[52px] btn-touch'  // Büyük
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className} touch-enhanced`}
    >
      {Icon && <Icon size={size === 'sm' ? 18 : size === 'lg' ? 22 : 20} className="mr-2 flex-shrink-0" />}
      <span className="truncate">{children}</span>
    </button>
  );
};

export default Button;