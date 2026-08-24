import React from 'react';
import { ArrowLeft, Package, MessageSquare, ShieldCheck, User, Sparkles, SlidersHorizontal, Flame } from 'lucide-react';

export const UniversalPageLoader: React.FC<{ message?: string }> = ({ message = "Loading TedBuy..." }) => (
  <div className="flex-1 w-full min-h-[60vh] flex flex-col items-center justify-center py-16 px-4 font-sans animate-fade-in">
    <div className="relative flex flex-col items-center justify-center">
      {/* Ambient Pulsing Glow behind Logo */}
      <div className="absolute w-24 h-24 bg-gradient-to-tr from-amber-500/20 to-orange-600/20 rounded-full blur-xl animate-pulse" />
      
      {/* TedBuy Logo Icon */}
      <div className="relative w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center shadow-lg mb-4 overflow-hidden">
        <img src="/favicon.svg" alt="TedBuy" className="w-10 h-10 object-contain animate-pulse-slow" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent animate-shimmer" />
      </div>

      {/* Modern Spinner */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 border-2 border-slate-200 border-t-[#ea580c] rounded-full animate-spin" />
        <span className="text-xs font-black text-slate-800 uppercase tracking-wider font-sans">
          Ted<span className="text-[#ea580c]">Buy</span> Ghana
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-500 font-medium tracking-wide animate-pulse text-center max-w-xs">
        {message}
      </p>
    </div>
  </div>
);

export const ProductDetailSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-pulse font-sans min-h-[80vh]">
    {/* Navigation Breadcrumb Skeleton */}
    <div className="flex items-center gap-2">
      <div className="h-4 w-24 bg-slate-200 rounded-md" />
      <div className="h-4 w-3 bg-slate-200 rounded-md" />
      <div className="h-4 w-32 bg-slate-200 rounded-md" />
      <div className="h-4 w-3 bg-slate-200 rounded-md" />
      <div className="h-4 w-44 bg-slate-200 rounded-md" />
    </div>

    {/* Top Action Back Button */}
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 h-8 w-24 bg-slate-200 rounded-xl" />
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 bg-slate-200 rounded-full" />
        <div className="h-8 w-8 bg-slate-200 rounded-full" />
      </div>
    </div>

    {/* Main Grid Skeleton */}
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Media & Gallery Skeleton (Left 7 cols) */}
      <div className="lg:col-span-7 space-y-4">
        <div className="w-full aspect-[4/3] rounded-3xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-slate-400 relative overflow-hidden">
          <div className="w-12 h-12 rounded-2xl bg-slate-200 flex items-center justify-center mb-3">
            <Package className="w-6 h-6 text-slate-400 animate-bounce" />
          </div>
          <div className="h-3 w-40 bg-slate-200 rounded-full mb-2" />
          <div className="h-2.5 w-24 bg-slate-200 rounded-full" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
        </div>

        {/* Thumbnail ribbon */}
        <div className="flex gap-3 overflow-x-auto py-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 shrink-0 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          ))}
        </div>

        {/* Detailed specifications skeleton block */}
        <div className="p-6 bg-white border border-slate-200 rounded-3xl space-y-4 mt-6">
          <div className="h-5 w-40 bg-slate-200 rounded-md" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                <div className="h-3 w-16 bg-slate-200 rounded" />
                <div className="h-4 w-24 bg-slate-300 rounded" />
              </div>
            ))}
          </div>
          <div className="space-y-2 pt-4">
            <div className="h-4 bg-slate-100 rounded w-full" />
            <div className="h-4 bg-slate-100 rounded w-5/6" />
            <div className="h-4 bg-slate-100 rounded w-4/6" />
          </div>
        </div>
      </div>

      {/* Details & Pricing Skeleton (Right 5 cols) */}
      <div className="lg:col-span-5 space-y-5">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-5 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="h-6 w-24 bg-orange-100 rounded-full" />
            <div className="h-4 w-16 bg-slate-100 rounded" />
          </div>
          <div className="h-8 w-4/5 bg-slate-200 rounded-xl" />
          <div className="h-10 w-44 bg-slate-900/10 rounded-2xl" />

          <div className="flex items-center gap-4 pt-1">
            <div className="h-4 w-28 bg-slate-100 rounded" />
            <div className="h-4 w-24 bg-slate-100 rounded" />
          </div>

          {/* Seller Card Skeleton */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="w-12 h-12 rounded-full bg-slate-200 shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-32 bg-slate-200 rounded" />
                <div className="h-3 w-20 bg-slate-100 rounded" />
              </div>
            </div>
          </div>

          {/* Action Buttons Skeleton */}
          <div className="space-y-2.5 pt-2">
            <div className="h-12 w-full bg-orange-500/20 rounded-2xl" />
            <div className="h-12 w-full bg-emerald-500/20 rounded-2xl" />
          </div>
        </div>

        {/* Safety Tips Skeleton */}
        <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 space-y-3">
          <div className="h-4 w-32 bg-slate-200 rounded" />
          <div className="h-3 w-full bg-slate-200/60 rounded" />
          <div className="h-3 w-4/5 bg-slate-200/60 rounded" />
        </div>
      </div>
    </div>
  </div>
);

export const ChatInterfaceSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto w-full px-0 sm:px-6 lg:px-8 py-0 sm:py-6 font-sans min-h-[70vh]">
    <div className="bg-white border-0 sm:border border-slate-200 sm:rounded-3xl shadow-xs overflow-hidden flex flex-col md:grid md:grid-cols-12 h-[calc(100vh-140px)] min-h-[500px]">
      {/* Left Column: Inbox List Skeleton */}
      <div className="md:col-span-4 border-r border-slate-150 flex flex-col h-full bg-slate-50">
        <div className="p-4 border-b border-slate-150 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-slate-400 animate-pulse" />
            <div className="h-5 w-28 bg-slate-200 rounded-md animate-pulse" />
          </div>
          <div className="h-4 w-12 bg-slate-100 rounded-full" />
        </div>
        <div className="p-3 bg-white border-b border-slate-100">
          <div className="h-9 bg-slate-100 rounded-xl animate-pulse" />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="p-3.5 flex items-center gap-3 bg-white animate-pulse">
              <div className="w-12 h-12 rounded-2xl bg-slate-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="h-4 w-28 bg-slate-200 rounded" />
                  <div className="h-3 w-10 bg-slate-100 rounded" />
                </div>
                <div className="h-3 w-40 bg-slate-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Chat Room Skeleton */}
      <div className="hidden md:flex md:col-span-8 flex-col h-full bg-slate-100/60">
        {/* Chat Header Skeleton */}
        <div className="p-4 bg-white border-b border-slate-150 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-200 animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-20 bg-slate-100 rounded" />
            </div>
          </div>
          <div className="h-8 w-24 bg-slate-100 rounded-xl" />
        </div>

        {/* Message Bubbles Skeleton */}
        <div className="flex-1 p-6 space-y-4 overflow-y-auto">
          {/* Peer message */}
          <div className="flex items-end gap-2.5 max-w-[70%]">
            <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0" />
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl rounded-bl-sm space-y-1.5 shadow-2xs">
              <div className="h-3.5 w-48 bg-slate-150 rounded animate-pulse" />
              <div className="h-3.5 w-32 bg-slate-150 rounded animate-pulse" />
            </div>
          </div>

          {/* User message */}
          <div className="flex items-end justify-end gap-2.5 max-w-[70%] ml-auto">
            <div className="p-3.5 bg-slate-900 text-white rounded-2xl rounded-br-sm space-y-1.5 shadow-2xs">
              <div className="h-3.5 w-40 bg-slate-700 rounded animate-pulse" />
            </div>
          </div>

          {/* Peer message */}
          <div className="flex items-end gap-2.5 max-w-[70%]">
            <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0" />
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl rounded-bl-sm space-y-1.5 shadow-2xs">
              <div className="h-3.5 w-56 bg-slate-150 rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* Input Bar Skeleton */}
        <div className="p-4 bg-white border-t border-slate-150 flex items-center gap-3">
          <div className="h-11 flex-1 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="w-11 h-11 bg-slate-900 rounded-2xl animate-pulse" />
        </div>
      </div>
    </div>
  </div>
);

export const SellerDashboardSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-pulse font-sans min-h-[70vh]">
    <div className="h-8 bg-slate-200 rounded-xl w-1/4" />
    <div className="h-4 bg-slate-200 rounded-md w-1/2" />
    
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-24 bg-slate-100 border border-slate-200 rounded-2xl p-4 space-y-2">
          <div className="h-3 w-16 bg-slate-200 rounded" />
          <div className="h-6 w-20 bg-slate-300 rounded" />
        </div>
      ))}
    </div>

    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 mt-8">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div key={i} className="h-72 bg-slate-100 border border-slate-200 rounded-3xl" />
      ))}
    </div>
  </div>
);

export const SellerProfileSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-pulse font-sans min-h-[70vh]">
    {/* Profile Header Card */}
    <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
        <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-slate-200 shrink-0" />
        <div className="space-y-3 flex-1 text-center sm:text-left">
          <div className="h-7 w-48 bg-slate-200 rounded-xl mx-auto sm:mx-0" />
          <div className="h-4 w-32 bg-slate-150 rounded mx-auto sm:mx-0" />
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
            <div className="h-6 w-24 bg-slate-100 rounded-full" />
            <div className="h-6 w-28 bg-slate-100 rounded-full" />
          </div>
        </div>
        <div className="h-10 w-32 bg-slate-900/10 rounded-2xl" />
      </div>
    </div>

    {/* Listings Grid Skeleton */}
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-72 bg-slate-100 border border-slate-200 rounded-3xl" />
      ))}
    </div>
  </div>
);

export const ProfileSettingsSkeleton: React.FC = () => (
  <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-pulse font-sans min-h-[70vh]">
    <div className="h-8 bg-slate-200 rounded-xl w-1/3" />
    <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
        <div className="w-16 h-16 rounded-full bg-slate-200 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-5 w-40 bg-slate-200 rounded" />
          <div className="h-4 w-28 bg-slate-150 rounded" />
        </div>
      </div>
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-24 bg-slate-200 rounded" />
            <div className="h-11 w-full bg-slate-100 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const FeaturedListingsSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-pulse font-sans min-h-[70vh]">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-orange-100" />
      <div className="h-7 w-48 bg-slate-200 rounded-xl" />
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div key={i} className="h-72 bg-slate-100 border border-slate-200 rounded-3xl" />
      ))}
    </div>
  </div>
);
