import { create } from 'zustand';
import { api } from '../lib/api';

interface AuthState {
  accessToken: string | null;
  user: { id: string; email: string; role: string } | null;
  tenantId: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: localStorage.getItem('accessToken'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  tenantId: localStorage.getItem('tenantId'),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('tenantId', data.tenantId ?? '');
    const user = { id: data.userId ?? '', email, role: data.role ?? 'admin' };
    localStorage.setItem('user', JSON.stringify(user));
    set({ accessToken: data.accessToken, user, tenantId: data.tenantId });
  },

  logout: () => {
    localStorage.clear();
    set({ accessToken: null, user: null, tenantId: null });
  },

  isAuthenticated: () => !!get().accessToken,
}));
