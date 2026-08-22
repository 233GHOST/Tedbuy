import React from 'react';
import { User, isUserAdmin, isUserVerified } from '../types';

interface SellerBadgeProps {
  seller?: User | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const SellerBadge: React.FC<SellerBadgeProps> = ({ seller, className = '', size = 'md' }) => {
  if (!seller) return null;

  const isAdmin = isUserAdmin(seller);
  const isVerified = isUserVerified(seller);

  if (isAdmin) {
    const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5.5 h-5.5' : 'w-4.5 h-4.5';
    return (
      <img
        src="/admin-badge.svg"
        alt="Official TedBuy Admin Badge"
        className={`${iconSize} inline-block shrink-0 align-middle ${className}`}
        title="Official TedBuy Admin Account"
      />
    );
  }

  if (isVerified) {
    if (size === 'sm') {
      return (
        <span className={`inline-flex items-center gap-0.5 text-[9px] text-indigo-700 font-extrabold bg-indigo-50 border border-indigo-150/40 px-1.5 py-0.5 rounded-md shrink-0 ${className}`} title="Verified Seller">
          🛡️ Verified Seller
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] sm:text-xs bg-emerald-500/20 text-emerald-400 font-extrabold border border-emerald-500/25 px-2.5 py-0.5 rounded-full shrink-0 ${className}`} title="Verified Seller">
        🛡️ Verified Seller
      </span>
    );
  }

  return null;
};
