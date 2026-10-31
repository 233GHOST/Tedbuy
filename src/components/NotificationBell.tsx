import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { AppNotification } from '../types';

// Top-bar bell: unread count and the latest notices (all types). Tapping one marks it read and
// opens what it is about; order notices open that order on the buyer's or seller's screen.
// Not shown signed out, or inside the app's WebView (the app sends phone notifications).

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function NotificationBell() {
  const {
    currentUser, isEmbedded, notifications, markNotificationAsRead, markAllNotificationsAsRead, clearAllNotifications,
    openOrder, setCurrentView, setSelectedProductId, setSelectedSellerId, setActiveChatId,
  } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!currentUser || isEmbedded) return null;

  const mine = (notifications ?? [])
    .filter(n => n.userId === currentUser.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const unread = mine.filter(n => !n.read).length;
  const shown = mine.slice(0, 30);

  const go = (n: AppNotification) => {
    setOpen(false);
    if (!n.read) markNotificationAsRead(n.id).catch(() => {});
    if (n.type.startsWith('dropship_order') && n.relatedId) {
      const as = n.type.slice('dropship_order_'.length);
      openOrder(as === 'buyer' || as === 'reseller' || as === 'supplier' ? as : null, n.relatedId);
    } else if (n.type === 'new_message') {
      if (n.chatId) setActiveChatId(n.chatId);
      setCurrentView('chats');
    } else if (n.type === 'new_follower' && n.triggerUserId) {
      setSelectedSellerId(n.triggerUserId);
      setCurrentView('seller-profile');
    } else if (n.productId) {
      setSelectedProductId(n.productId);
      setCurrentView('product-detail');
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id="nav-btn-notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all relative text-slate-300 hover:bg-slate-800/60 hover:text-white"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-slate-900">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-16 sm:top-full sm:mt-2 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-lg z-50 overflow-hidden text-left">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-black text-slate-900">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => markAllNotificationsAsRead().catch(() => {})}
                className="text-[11px] font-bold text-sky-700 hover:text-sky-900 cursor-pointer">Mark all read</button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500">No notifications yet.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
              {shown.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => go(n)}
                    className={`w-full px-4 py-3 text-left flex gap-3 hover:bg-slate-50 cursor-pointer ${n.read ? '' : 'bg-sky-50/50'}`}>
                    <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read ? 'bg-transparent' : 'bg-sky-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-slate-900 truncate">{n.title}</span>
                      <span className="block text-[11px] text-slate-600 line-clamp-2">{n.message}</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shown.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 text-right">
              <button type="button"
                onClick={() => { if (window.confirm('Clear all notifications?')) clearAllNotifications().catch(() => {}); }}
                className="text-[11px] font-bold text-slate-500 hover:text-rose-700 cursor-pointer">Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
