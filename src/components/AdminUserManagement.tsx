import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Search, UserCheck, ShieldAlert, Loader2, RefreshCw, History, User, Mail, Shield, CheckCircle2, AlertTriangle, Lock, Unlock, Trash2 } from 'lucide-react';
import { User as UserType, ImpersonationAuditLog } from '../types';

export const AdminUserManagement: React.FC = () => {
  const { currentUser, startImpersonation, isImpersonating, setCurrentView, getAuthHeader, adminToggleSecurityHold, showToast } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultUsers, setSearchResultUsers] = useState<UserType[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  
  const [auditLogs, setAuditLogs] = useState<ImpersonationAuditLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);

  const [deletedAccounts, setDeletedAccounts] = useState<any[]>([]);
  const [isLoadingDeleted, setIsLoadingDeleted] = useState(false);
  const [showDeletedModal, setShowDeletedModal] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  const [impersonatingTargetId, setImpersonatingTargetId] = useState<string | null>(null);
  const [holdingTargetId, setHoldingTargetId] = useState<string | null>(null);

  const isBaseAdmin = currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || currentUser?.isAdmin;

  // Initial user fetch
  const handleSearchUsers = async (query?: string) => {
    setIsSearching(true);
    setSearchError('');
    try {
      const headers = await getAuthHeader();
      const qVal = query !== undefined ? query : searchQuery;
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(qVal.trim())}`, {
        headers
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.users)) {
        setSearchResultUsers(data.users);
      } else {
        setSearchError(data.error || 'Failed to search users.');
      }
    } catch (err: any) {
      console.error('[AdminUserManagement] Search error:', err);
      setSearchError(err?.message || 'Network error searching users.');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (isBaseAdmin) {
      handleSearchUsers('');
    }
  }, [isBaseAdmin]);

  const handleFetchAuditLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/admin/impersonate/logs', { headers });
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        setAuditLogs(data.logs);
      }
    } catch (err) {
      console.error('[AdminUserManagement] Audit logs error:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleFetchDeletedAccounts = async () => {
    setIsLoadingDeleted(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/admin/accounts/deleted', { headers });
      const data = await res.json();
      if (data.success && Array.isArray(data.accounts)) {
        setDeletedAccounts(data.accounts);
      }
    } catch (err) {
      console.error('[AdminUserManagement] Deleted accounts fetch error:', err);
    } finally {
      setIsLoadingDeleted(false);
    }
  };

  const handleRunPurge = async () => {
    if (!confirm('Run automated retention purge for all accounts past their 90-day retention/quarantine window?')) return;
    setIsPurging(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/admin/retention/run-purge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Retention purge completed. Purged ${data.purgedCount || 0} expired records.`, 'success');
        handleFetchDeletedAccounts();
      } else {
        showToast(data.error || 'Purge failed', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Network error running purge', 'error');
    } finally {
      setIsPurging(false);
    }
  };

  const handleToggleHold = async (targetUser: UserType) => {
    const isCurrentHold = !!targetUser.securityHold;
    const reason = !isCurrentHold ? prompt('Enter reason for placing security hold (e.g. Fraud Investigation, Chargeback Dispute):', 'Fraud Investigation') : '';
    if (!isCurrentHold && reason === null) return;

    setHoldingTargetId(targetUser.id);
    try {
      await adminToggleSecurityHold(targetUser.id, !isCurrentHold, reason || undefined);
      // Refresh list
      handleSearchUsers();
    } catch (err: any) {
      showToast(err?.message || 'Failed to toggle security hold.', 'error');
    } finally {
      setHoldingTargetId(null);
    }
  };

  const handleImpersonateClick = async (targetUser: UserType) => {
    if (targetUser.id === currentUser?.id) {
      alert('You are already logged into this account as the administrator.');
      return;
    }
    setImpersonatingTargetId(targetUser.id);
    try {
      await startImpersonation(targetUser.id);
      setCurrentView('browse');
    } catch (err: any) {
      alert(err?.message || 'Failed to start impersonation session.');
    } finally {
      setImpersonatingTargetId(null);
    }
  };

  if (!isBaseAdmin) return null;

  return (
    <div id="admin-user-impersonation-card" className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-6 sm:p-8 mt-8 space-y-6 text-left shadow-xl">
      {/* Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/30">
            <UserCheck className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h3 className="text-base font-black uppercase tracking-wider text-slate-100 flex items-center gap-2">
              <span>Admin User Management & Security Holds</span>
              <span className="bg-amber-500/20 text-amber-300 text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 font-mono font-bold">SECURE</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Troubleshoot accounts, manage security investigation holds, and audit retention lifecycle.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setShowDeletedModal(!showDeletedModal);
              if (!showDeletedModal) handleFetchDeletedAccounts();
            }}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>{showDeletedModal ? 'Hide Retention' : 'Retention & Deletions'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowLogsModal(!showLogsModal);
              if (!showLogsModal) handleFetchAuditLogs();
            }}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <History className="w-4 h-4 text-amber-400" />
            <span>{showLogsModal ? 'Hide Impersonation Logs' : 'Impersonation Logs'}</span>
          </button>
        </div>
      </div>

      {/* Search Controls */}
      <div className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearchUsers();
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search user by Email, Firebase UID, Username or Phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 text-slate-100 text-xs font-sans rounded-2xl pl-10 pr-4 py-3 outline-none transition"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="px-5 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-2xl shadow-md flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
          >
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Search Users</span>
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                handleSearchUsers('');
              }}
              className="px-3.5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-2xl transition cursor-pointer"
            >
              Reset
            </button>
          )}
        </form>

        {searchError && (
          <p className="text-xs text-rose-400 bg-rose-950/50 border border-rose-800/60 p-2.5 rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{searchError}</span>
          </p>
        )}
      </div>

      {/* Users Results List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider px-1">
          <span>Matched Accounts ({searchResultUsers.length})</span>
          <span>Security & Actions</span>
        </div>

        {isSearching ? (
          <div className="p-8 text-center bg-slate-950/60 rounded-2xl border border-slate-850">
            <Loader2 className="w-6 h-6 animate-spin text-amber-400 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Searching user database...</p>
          </div>
        ) : searchResultUsers.length === 0 ? (
          <div className="p-8 text-center bg-slate-950/60 rounded-2xl border border-slate-850 space-y-2">
            <User className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-400 font-medium">No user accounts found matching your query.</p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {searchResultUsers.map((user) => {
              const isCurrentUser = user.id === currentUser?.id;
              const isTargeting = impersonatingTargetId === user.id;
              const isHolding = holdingTargetId === user.id;
              const isSuperAdminUser = user.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com';
              const hasHold = !!user.securityHold;
              const isDeleted = user.isDeleted || user.status === 'deleted';

              return (
                <div
                  key={user.id}
                  className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition"
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center font-bold text-amber-400 text-sm">
                      {user.photoUrl ? (
                        <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
                      ) : (
                        (user.username || user.email || 'U').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-100 truncate">{user.username || 'Tedbuy User'}</span>
                        {user.isAdmin && (
                          <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-800 rounded-full text-[9px] font-mono font-bold">
                            ADMIN
                          </span>
                        )}
                        {hasHold && (
                          <span className="px-2 py-0.5 bg-rose-950 text-rose-300 border border-rose-800 rounded-full text-[9px] font-mono font-bold flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            SECURITY HOLD
                          </span>
                        )}
                        {isDeleted && (
                          <span className="px-2 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-700 rounded-full text-[9px] font-mono font-bold">
                            SOFT DELETED
                          </span>
                        )}
                        {isCurrentUser && (
                          <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-full text-[9px] font-mono font-bold">
                            YOU
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-0.5 truncate">
                        <Mail className="w-3 h-3 text-slate-500" />
                        <span>{user.email || 'No email provided'}</span>
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                        UID: {user.id} {user.securityHoldReason ? `• Hold: ${user.securityHoldReason}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-850 flex-wrap">
                    {!isSuperAdminUser && (
                      <button
                        type="button"
                        onClick={() => handleToggleHold(user)}
                        disabled={isHolding}
                        className={`px-3 py-2 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition cursor-pointer ${
                          hasHold
                            ? 'bg-rose-900/40 hover:bg-rose-900/60 border-rose-700 text-rose-300'
                            : 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-300'
                        }`}
                        title={hasHold ? 'Release security hold' : 'Place account on security hold for investigation'}
                      >
                        {isHolding ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : hasHold ? (
                          <>
                            <Unlock className="w-3.5 h-3.5 text-rose-400" />
                            <span>Release Hold</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-3.5 h-3.5 text-slate-400" />
                            <span>Security Hold</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleImpersonateClick(user)}
                      disabled={isCurrentUser || isImpersonating || isTargeting || isDeleted}
                      className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isTargeting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Impersonate</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Deleted & Retention Audits Section */}
      {showDeletedModal && (
        <div className="bg-slate-950 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-3.5 animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              <span>Accounts Under Retention & Deletion Audits</span>
            </h4>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRunPurge}
                disabled={isPurging}
                className="px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold rounded-lg flex items-center gap-1.5 transition"
              >
                {isPurging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Run 90-Day Purge</span>
              </button>
              <button
                type="button"
                onClick={handleFetchDeletedAccounts}
                disabled={isLoadingDeleted}
                className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDeleted ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {isLoadingDeleted ? (
            <div className="p-6 text-center text-xs text-slate-400">Loading deleted accounts...</div>
          ) : deletedAccounts.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 font-mono">No soft-deleted or under-investigation accounts found.</div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 font-mono text-[11px]">
              {deletedAccounts.map((acc) => (
                <div key={acc.id} className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className={`font-bold uppercase ${acc.securityHold ? 'text-rose-400' : 'text-amber-300'}`}>
                      Status: {acc.status || (acc.isDeleted ? 'deleted' : 'active')} {acc.securityHold ? '(SECURITY HOLD ACTIVE)' : ''}
                    </span>
                    <span className="text-slate-500">Deleted: {acc.deletedAt ? new Date(acc.deletedAt).toLocaleDateString() : 'N/A'}</span>
                  </div>
                  <p className="text-slate-300 text-[10px]">
                    UID: <span className="text-amber-400">{acc.id}</span> • Username: <span className="text-emerald-400">{acc.username || 'Anonymized'}</span>
                  </p>
                  {acc.securityHoldReason && (
                    <p className="text-rose-300 text-[10px]">
                      Reason: {acc.securityHoldReason}
                    </p>
                  )}
                  {acc.quarantineExpiresAt && (
                    <p className="text-slate-400 text-[10px]">
                      Quarantine Expires: {new Date(acc.quarantineExpiresAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Impersonation Audit Logs Section */}
      {showLogsModal && (
        <div className="bg-slate-950 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-3.5 animate-fade-in">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <History className="w-4 h-4" />
              <span>Impersonation Security Audit History</span>
            </h4>
            <button
              type="button"
              onClick={handleFetchAuditLogs}
              disabled={isLoadingLogs}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {isLoadingLogs ? (
            <div className="p-6 text-center text-xs text-slate-400">Loading audit records...</div>
          ) : auditLogs.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 font-mono">No impersonation audit logs recorded yet.</div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 font-mono text-[11px]">
              {auditLogs.map((log) => (
                <div key={log.id} className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-amber-300 uppercase">{log.action}</span>
                    <span className="text-slate-500">{new Date(log.created_at || log.start_time).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-300 text-[10px] leading-relaxed">
                    Admin: <span className="text-emerald-400">{log.admin_email || log.admin_user_id}</span> • Target User: <span className="text-amber-400">{log.target_user_email || log.target_user_id}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
