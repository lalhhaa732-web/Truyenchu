import React, { useState } from 'react';
import { X, ShieldCheck, Sparkles, AlertCircle } from 'lucide-react';
import { UserProfileData } from './UserProfileModal';

export type AuthModalMode = 'login' | 'register' | null;

interface AuthGoogleModalProps {
  mode: AuthModalMode;
  onClose: () => void;
  onSwitchMode: (mode: 'login' | 'register') => void;
  onAuthenticateGoogle: (
    mode: 'login' | 'register',
    registrationData?: Partial<UserProfileData>
  ) => Promise<void>;
}

export const AuthGoogleModal: React.FC<AuthGoogleModalProps> = ({
  mode,
  onClose,
  onSwitchMode,
  onAuthenticateGoogle
}) => {
  const [customNickname, setCustomNickname] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!mode) return null;

  const handleGoogleAction = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      if (mode === 'register') {
        await onAuthenticateGoogle('register', {
          ...(customNickname.trim() ? { nickname: customNickname.trim() } : {})
        });
      } else {
        await onAuthenticateGoogle('login');
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user')) {
        setErrorMsg('Cửa sổ đăng nhập Google đã đóng trước khi hoàn tất.');
      } else {
        setErrorMsg('Không thể kết nối Google. Vui lòng thử lại.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl bg-[#181824] text-stone-100 border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-[#1E1E2E] border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              {mode === 'login' ? 'Đăng nhập Mạc Thư Các' : 'Đăng ký tài khoản mới'}
            </h2>
            <p className="text-xs text-stone-400 mt-0.5">
              {mode === 'login'
                ? 'Đồng bộ tủ sách, cấp độ & tiến độ đọc qua Google'
                : 'Khởi tạo hồ sơ độc giả với tài khoản Google'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs: Đăng nhập | Đăng ký */}
        <div className="grid grid-cols-2 p-1.5 bg-[#13131C] border-b border-white/10 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              onSwitchMode('login');
            }}
            className={`py-2.5 rounded-xl transition-colors cursor-pointer ${
              mode === 'login'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-stone-400 hover:text-white'
            }`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              onSwitchMode('register');
            }}
            className={`py-2.5 rounded-xl transition-colors cursor-pointer ${
              mode === 'register'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-stone-400 hover:text-white'
            }`}
          >
            Đăng ký bằng Google
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {mode === 'register' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-stone-300">
                  Biệt danh độc giả (để trống sẽ lấy theo tên Google)
                </label>
                <input
                  type="text"
                  value={customNickname}
                  onChange={(e) => setCustomNickname(e.target.value)}
                  maxLength={40}
                  placeholder="VD: Kiếm Khách Ly Châu..."
                  className="w-full h-10 px-3.5 rounded-xl bg-white/5 border border-white/15 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2.5 text-xs text-stone-300">
              <div className="flex items-center gap-2 text-white font-semibold">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                <span>Quyền lợi khi đăng nhập bằng Google:</span>
              </div>
              <ul className="space-y-1.5 text-stone-400 pl-6 list-disc">
                <li>Tự động lưu vị trí chương đang đọc và danh sách truyện theo dõi.</li>
                <li>Đồng bộ cấp độ (`Lv`) và danh hiệu độc giả.</li>
                <li>Nhập truyện từ URL và lưu trữ vĩnh viễn trên đám mây Firebase.</li>
              </ul>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Official Google Sign-In / Sign-Up Button */}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleGoogleAction}
            className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-white hover:bg-stone-100 text-stone-900 font-semibold text-sm flex items-center justify-center gap-3 shadow-lg transition-all cursor-pointer disabled:opacity-60"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
              />
            </svg>
            <span>
              {isSubmitting
                ? 'Đang kết nối Google...'
                : mode === 'login'
                ? 'Tiếp tục đăng nhập với Google'
                : 'Đăng ký nhanh bằng Google'}
            </span>
          </button>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-stone-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Xác thực bảo mật bởi Google & Firebase Authentication</span>
          </div>
        </div>
      </div>
    </div>
  );
};
