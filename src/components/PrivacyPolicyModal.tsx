import React from 'react';
import { X, ShieldCheck, Mail, Database, Trash2, Download } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div 
        id="privacy-policy-modal-box"
        className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden text-left flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-900/10 rounded-lg text-slate-800">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 font-sans tracking-tight uppercase">
                Privacy Policy & Data Disclosure
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-none">
                Compliance, transparency, and control of your personal data
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 hover:text-slate-900 rounded-lg text-slate-400 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-600 leading-relaxed font-sans">
          <div className="bg-emerald-50 border border-emerald-150 rounded-2xl p-4 flex gap-3 items-start">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-extrabold text-emerald-950 text-xs">Fully Compliant & Protected</h4>
              <p className="text-[11px] text-emerald-800 leading-normal">
                Tedbuy is fully committed to user privacy. We comply with general data protection rules, empowering you with the tools to manage, export, and erase your data at any time.
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h4 className="font-black text-slate-850 text-xs uppercase tracking-wider flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              1. Information We Collect
            </h4>
            <p>
              To offer a safe, transparent classified ads platform, we process specific personal data. The types of data we collect include:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[11px] text-slate-500">
              <li><strong>Profile Metadata:</strong> Username, email address, phone number, WhatsApp number, and optional profile picture.</li>
              <li><strong>User Content:</strong> Products/listings posted, reviews written, seller ratings, and connection network (followers/following).</li>
              <li><strong>Messages & Chats:</strong> Private peer-to-peer conversations to organize purchase physical inspections and payment terms.</li>
              <li><strong>System Cookies & Local Storage:</strong> Strictly necessary identifiers used to keep you securely signed in and save persistent layout states.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h4 className="font-black text-slate-850 text-xs uppercase tracking-wider">
              2. Lawful Basis for Processing
            </h4>
            <p>
              We process your personal information based on:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[11px] text-slate-500">
              <li><strong>Consent:</strong> When you register or agree to our Cookie settings.</li>
              <li><strong>Contract Fulfillment:</strong> Enabling direct buyer-to-seller classified marketplace communication.</li>
              <li><strong>Legitimate Interests:</strong> Keeping the platform secure from spam, bots, fraudulent activity, or listing abuse.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h4 className="font-black text-slate-850 text-xs uppercase tracking-wider">
              3. Data Visibility & Safety
            </h4>
            <p>
              By default, Tedbuy is a classified matching marketplace. Therefore, to allow buyers to contact you, your <strong>WhatsApp number</strong> and <strong>Username</strong> are displayed publicly on listings you post. Private password credentials are stored as heavy one-way cryptographic hashes via Firebase Authentication and are never visible.
            </p>
          </section>

          <section className="space-y-2">
            <h4 className="font-black text-slate-850 text-xs uppercase tracking-wider flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5 text-slate-500" />
              4. Your Personal Data Rights
            </h4>
            <p>
              You hold the following fundamental personal data rights:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3 border border-slate-150 rounded-2xl bg-slate-50/50">
                <h5 className="font-bold text-slate-800 text-[11px] mb-1">Right to Access</h5>
                <p className="text-[10px] text-slate-500 leading-normal">
                  View and update all your settings, profiles, and listing details transparently via Settings.
                </p>
              </div>
              <div className="p-3 border border-slate-150 rounded-2xl bg-slate-50/50">
                <h5 className="font-bold text-slate-800 text-[11px] mb-1">Right to Erasure</h5>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Permanently delete your profile and all peer listings from our cloud instantaneously in the Profile Danger Zone.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-3xs"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
};
