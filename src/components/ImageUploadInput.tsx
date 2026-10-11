import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  Image as ImageIcon,
  Link,
  Trash2,
  Check,
  Sparkles,
  Camera,
  AlertCircle,
} from 'lucide-react';
import { Language } from '../types';

interface ImageUploadInputProps {
  label?: string;
  value?: string;
  onChange: (dataUrlOrUrl: string) => void;
  currentLanguage: Language;
  presetAvatars?: string[];
  helperText?: string;
}

// Preset avatars for quick selection
const DEFAULT_PRESETS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=250&auto=format&fit=crop&q=80',
];

/**
 * Resizes and compresses an image data URL on a client-side canvas
 */
function compressImage(file: File, maxWidth = 500, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxWidth) {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export const ImageUploadInput: React.FC<ImageUploadInputProps> = ({
  label,
  value,
  onChange,
  currentLanguage,
  presetAvatars = DEFAULT_PRESETS,
  helperText,
}) => {
  const isEn = currentLanguage === 'en';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState(value || '');
  const [errorMessage, setErrorMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage(
        isEn
          ? 'Please select a valid image file (.jpg, .png, .webp)'
          : 'Por favor, selecione um arquivo de imagem válido (.jpg, .png, .webp)'
      );
      return;
    }

    setErrorMessage('');
    setIsProcessing(true);
    try {
      const compressedDataUrl = await compressImage(file);
      onChange(compressedDataUrl);
      setUrlDraft(compressedDataUrl);
    } catch (err) {
      setErrorMessage(
        isEn
          ? 'Error processing image. Please try again.'
          : 'Erro ao processar imagem. Tente novamente.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleApplyUrl = () => {
    if (urlDraft.trim()) {
      onChange(urlDraft.trim());
      setShowUrlInput(false);
    }
  };

  const handleRemove = () => {
    onChange('');
    setUrlDraft('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-xs font-bold text-slate-700">
          {label}
        </label>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInputChange}
        className="hidden"
        id="profile-image-file-input"
      />

      {/* Main Upload / Preview Area */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 sm:p-4 transition">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {/* Avatar Preview */}
          <div className="relative group shrink-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-slate-200 border-2 border-[#1C4C96]/30 shadow-sm flex items-center justify-center relative">
              {value && value.trim() !== '' ? (
                <img
                  src={value}
                  alt="Avatar Preview"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                  <Camera className="w-7 h-7 mb-1 text-slate-400" />
                  <span className="text-[10px] font-semibold leading-tight">
                    {isEn ? 'No photo' : 'Sem foto'}
                  </span>
                </div>
              )}

              {isProcessing && (
                <div className="absolute inset-0 bg-[#000035]/60 flex items-center justify-center text-white">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {value && (
              <button
                type="button"
                onClick={handleRemove}
                title={isEn ? 'Remove Photo' : 'Remover Foto'}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-md transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Upload Drop Zone & Actions */}
          <div className="flex-1 w-full space-y-2">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-3 sm:p-4 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1 ${
                isDragging
                  ? 'border-[#1C4C96] bg-[#9AB4FF]/20 text-[#062863]'
                  : 'border-slate-300 hover:border-[#1C4C96] hover:bg-white text-slate-600'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-[#1C4C96]/10 flex items-center justify-center text-[#1C4C96]">
                <UploadCloud className="w-4 h-4" />
              </div>
              <p className="text-xs font-bold text-[#000035]">
                {isEn ? 'Click to upload or drag & drop' : 'Clique para carregar ou arraste a foto'}
              </p>
              <p className="text-[10px] text-slate-500">
                {isEn ? 'PNG, JPG, WebP up to 10MB (auto-compressed)' : 'PNG, JPG, WebP de até 10MB (otimizada)'}
              </p>
            </div>

            {/* URL toggle & presets toggle */}
            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => setShowUrlInput(!showUrlInput)}
                className="text-[#1C4C96] hover:underline font-semibold flex items-center gap-1 cursor-pointer text-[11px]"
              >
                <Link className="w-3 h-3" />
                <span>{isEn ? 'Paste Image URL instead' : 'Ou colar link direto da imagem'}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg font-bold text-[11px] text-[#000035] transition cursor-pointer shadow-2xs"
              >
                {isEn ? 'Browse Files' : 'Escolher Arquivo'}
              </button>
            </div>

            {/* Optional URL Input drawer */}
            {showUrlInput && (
              <div className="pt-2 flex gap-1.5 animate-in fade-in duration-150">
                <input
                  type="url"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-[#000035]"
                />
                <button
                  type="button"
                  onClick={handleApplyUrl}
                  className="px-3 py-1.5 bg-[#062863] text-white rounded-xl text-xs font-bold hover:bg-[#000035] transition cursor-pointer shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Preset sample avatars */}
        {presetAvatars && presetAvatars.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                {isEn ? 'Or choose a preset avatar:' : 'Ou escolha um avatar sugerido:'}
              </span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {presetAvatars.map((presetUrl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onChange(presetUrl);
                    setUrlDraft(presetUrl);
                  }}
                  className={`w-9 h-9 rounded-xl overflow-hidden border-2 transition shrink-0 cursor-pointer ${
                    value === presetUrl
                      ? 'border-[#1C4C96] scale-110 shadow-xs ring-2 ring-[#9AB4FF]/50'
                      : 'border-transparent hover:border-slate-300 opacity-80 hover:opacity-100'
                  }`}
                >
                  <img
                    src={presetUrl}
                    alt={`Preset ${idx + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-xl text-[11px] font-bold text-red-700 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {helperText && (
          <p className="text-[11px] text-slate-500 mt-2 italic">
            {helperText}
          </p>
        )}
      </div>
    </div>
  );
};
