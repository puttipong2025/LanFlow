"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/AuthProvider";
import { Eye, EyeOff, Leaf, Loader2, Phone, Lock } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading: authLoading } = useAuthContext();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      window.location.href = "/";
    }
  }, [authLoading, isAuthenticated]);

  if (authLoading || isAuthenticated) {
    return (
      <div className="login-page">
        <div className="login-loader">
          <Loader2 className="animate-spin" size={40} />
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!phone.trim()) {
      setError("กรุณากรอกเบอร์โทร");
      return;
    }
    if (!password) {
      setError("กรุณากรอกรหัสผ่าน");
      return;
    }

    setIsSubmitting(true);

    const result = await login(phone.trim(), password);
    setIsSubmitting(false);

    if (result.success) {
      window.location.href = "/";
    } else {
      setError(result.error || "เข้าสู่ระบบไม่สำเร็จ");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">
            <Leaf size={32} />
          </div>
          <h1 className="login-title">LanFlow</h1>
          <p className="login-subtitle">ระบบจัดการลานยาง</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          {/* Phone Input */}
          <div className="login-field">
            <label htmlFor="phone" className="login-label">
              เบอร์โทรศัพท์
            </label>
            <div className="login-input-wrap">
              <Phone size={18} className="login-input-icon" />
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="กรอก 10 หลัก เช่น 0812345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="login-input"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="login-field">
            <label htmlFor="password" className="login-label">
              รหัสผ่าน
            </label>
            <div className="login-input-wrap">
              <Lock size={18} className="login-input-icon" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input login-input-password"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="login-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="login-submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                กำลังดำเนินการ...
              </>
            ) : "เข้าสู่ระบบ"}
          </button>
        </form>

        <p className="login-footer">
          บัญชีผู้ใช้สร้างและกำหนดสาขาโดยผู้ดูแลระบบ
        </p>
      </div>

      <style jsx>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          background: linear-gradient(135deg, #1a3a2a 0%, #2f6b4f 40%, #3a8c6a 70%, #2f6b4f 100%);
        }

        .login-loader {
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .login-card {
          width: 100%;
          max-width: 400px;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          padding: 2.5rem 2rem;
          box-shadow:
            0 25px 50px -12px rgba(0, 0, 0, 0.4),
            0 0 0 1px rgba(255, 255, 255, 0.1);
          animation: slideUp 0.5s ease-out;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .login-logo {
          text-align: center;
          margin-bottom: 2rem;
        }

        .login-logo-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, #2f6b4f, #3a8c6a);
          border-radius: 16px;
          color: white;
          margin-bottom: 1rem;
          box-shadow: 0 4px 14px rgba(47, 107, 79, 0.4);
        }

        .login-title {
          font-size: 1.75rem;
          font-weight: 800;
          color: #17201b;
          margin: 0;
          letter-spacing: -0.02em;
        }

        .login-subtitle {
          font-size: 0.875rem;
          color: #5a6b5f;
          margin: 0.25rem 0 0;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .login-field {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .login-label {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #3a4a3f;
        }

        .login-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .login-input-icon {
          position: absolute;
          left: 0.875rem;
          color: #8a9b8f;
          pointer-events: none;
        }

        .login-input {
          width: 100%;
          height: 48px;
          padding: 0 0.875rem 0 2.75rem;
          border: 1.5px solid #d0dbd3;
          border-radius: 12px;
          font-size: 1rem;
          color: #17201b;
          background: white;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }

        .login-input:focus {
          border-color: #2f6b4f;
          box-shadow: 0 0 0 3px rgba(47, 107, 79, 0.15);
        }

        .login-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .login-input-password {
          padding-right: 3rem;
        }

        .login-eye-btn {
          position: absolute;
          right: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: #8a9b8f;
          cursor: pointer;
          transition: color 0.2s, background 0.2s;
        }

        .login-eye-btn:hover {
          color: #2f6b4f;
          background: rgba(47, 107, 79, 0.08);
        }

        .login-error {
          padding: 0.75rem 1rem;
          border-radius: 10px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          font-size: 0.875rem;
          text-align: center;
          animation: shake 0.4s ease-out;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        .login-submit {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          height: 48px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, #2f6b4f, #3a8c6a);
          color: white;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
          box-shadow: 0 4px 14px rgba(47, 107, 79, 0.35);
          margin-top: 0.25rem;
        }

        .login-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(47, 107, 79, 0.45);
        }

        .login-submit:active:not(:disabled) {
          transform: translateY(0);
        }

        .login-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .login-footer {
          text-align: center;
          font-size: 0.75rem;
          color: #8a9b8f;
          margin: 1.5rem 0 0;
        }
      `}</style>
    </div>
  );
}
