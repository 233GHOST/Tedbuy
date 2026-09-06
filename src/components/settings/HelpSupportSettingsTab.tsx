import React, { useState } from 'react';
import { HelpCircle, FileText, ShieldCheck, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

interface Props {
  initialSection?: 'help' | 'terms';
}

export const HelpSupportSettingsTab: React.FC<Props> = ({ initialSection = 'help' }) => {
  const [activeSection, setActiveSection] = useState<'help' | 'terms'>(initialSection);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const faqs = [
    {
      q: "How do I buy on TedBuy Ghana?",
      a: "Browse listings on our official tedbuy.store domain in your preferred categories and regions. When you find an item of interest, tap the listing card to view detailed specifications. You can message the seller directly using our secure in-app peer chat, or click the WhatsApp button to initiate a direct chat to negotiate, arrange trade, or meet."
    },
    {
      q: "How do I post a classified ad?",
      a: "Tapping the 'Sell' button at the center of the mobile bottom nav bar or the top desktop header opens the listing form. Fill in details, upload clear pictures or a 9:16 interactive video ad, choose your region and price, then publish. Note: verified active accounts receive higher query priority! All inputs are sanitized using industry-standard DOMPurify to eliminate security vulnerabilities."
    },
    {
      q: "How do the dynamic search specs and brand filters work?",
      a: "When you select a primary category (such as Phones, Vehicles, Laptops, or Property), our dynamic hierarchical filter panel automatically reveals matching spec options (like Brand, Model, Condition, Bedroom counts, or Fuel Type). Choosing a brand dynamically refines the model list instantly, allowing progressive and powerful filtering just like Jiji or eBay!"
    },
    {
      q: "What are Featured Listings and how does social media advertising boost my sales?",
      a: "Featured Listings are top-tier promotional placements designed to give your products maximum market visibility. In addition to premium homepage banner placement and top search indexing on TedBuy, we actively launch targeted social media ad campaigns across Facebook, Instagram, and TikTok for Featured Listings. By bringing external buyer traffic directly to your item, Featured Listings significantly increase impressions, buyer inquiries, and your overall speed of sale!"
    },
    {
      q: "What is Ad Boosting and how does it upgrade my listing?",
      a: "Ad Boosting is our automated seller promotion system that instantly converts your product into a Featured Listing. Choosing a boost plan elevates your item to the top of search feeds with priority ranking and enrolls it into our external social media advertising pipeline across Facebook, Instagram, and TikTok. Sellers can choose from five flexible plan tiers (3 Days Fast Boost, 7 Days Hot Deal Boost, 14 Days Premium Boost, 21 Days Elite Merchant Boost, or 1 Month Mega Store Boost) with secure payments via Mobile Money (MoMo) or Card."
    },
    {
      q: "What are interactive 9:16 Video Ads?",
      a: "They are immersive, vertical product video walkthroughs displayed directly in the feed for high buyer conversion. It is the best way to showcase real performance, physical condition, and build immediate buyer trust."
    },
    {
      q: "What is Account Verification?",
      a: "To ensure a clean marketplace, buyers and sellers can undergo system verification. This validates active email accounts using cryptographically secure 6-digit OTPs and increases community safety. Complete your verification securely inside your Profile Settings."
    },
    {
      q: "Can I delete my listings?",
      a: "Yes! You can easily delete any of your active listings from the product details or your profile page. To protect seller ownership, listings can only be deleted by the original listing owner or verified system administrators."
    },
    {
      q: "How does the secure peer trade delivery tracking work?",
      a: "Inside your secure chat, the seller can mark an item as 'Delivered' once dispatched. The buyer is then prompted to confirm 'Picked Up'. Once both actions are complete, the trade advances to a 'Completed' state. For security, once a trade reaches this completed terminal state, it is locked against further modification by any standard user to protect the integrity of the transaction."
    },
    {
      q: "Are there listing fees?",
      a: "Posting classified ads on Tedbuy Ghana is completely free. We do not charge listing fees or commissions. Trades and payments are completed directly between peers."
    }
  ];

  return (
    <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-3xs space-y-6 text-left animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">
            Support, Help & Agreements
          </h2>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Access official help document guides, FAQ items, and our Terms of Service in Ghana.
          </p>
        </div>

        {/* Inner Segmented control */}
        <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setActiveSection('help')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeSection === 'help'
                ? 'bg-white text-slate-900 shadow-3xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Help & FAQ</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('terms')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeSection === 'terms'
                ? 'bg-white text-slate-900 shadow-3xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Terms of Service</span>
          </button>
        </div>
      </div>

      {activeSection === 'help' ? (
        <div className="space-y-4 animate-fade-in">
          {/* Safety Banner */}
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-extrabold text-amber-900">Ghana Classifieds Safety Rule</h4>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                Always meet in well-lit public places (malls, transit hubs, fueling stations) and inspect the physical item thoroughly before completing any payment. Never send advance deposits.
              </p>
            </div>
          </div>

          <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 pt-2">
            Frequently Asked Questions
          </h3>

          <div className="space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={idx} className="border border-slate-200/70 rounded-2xl overflow-hidden transition-all bg-slate-50/20">
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between p-4 font-bold text-slate-850 hover:text-slate-950 transition text-xs text-left cursor-pointer"
                  >
                    <span>{faq.q}</span>
                    <span className="shrink-0 ml-4 font-extrabold text-slate-400">
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 text-xs text-slate-500 leading-relaxed border-t border-slate-100 animate-slide-in">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-slate-600 text-xs leading-relaxed max-h-[55vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200 animate-fade-in text-left">
          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">1. Agreement to Terms</h4>
            <p>Welcome to Tedbuy Ghana Classifieds (tedbuy.store). By creating an account or browsing listings, you agree to comply with our commercial marketplace policies. Services are provided of mutual peer communication.</p>
          </div>
          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">2. Use & Listing Guidelines</h4>
            <p>Users must provide accurate, non-misleading information for listings. Prohibited post items include illegal goods, counter-brand replicas, or unregistered financial services. We reserve prompt moderation rights over all publications.</p>
          </div>
          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">3. Safety & Payments Warning</h4>
            <p className="text-xs text-slate-600">TedBuy Classifieds is a peer-to-peer advertising provider. All product delivery, physical inspect evaluation, and financial settlement is coordinate solely between buyer and seller.</p>
            <div className="mt-2 bg-rose-50 border border-rose-200/60 p-3 rounded-2xl">
              <p className="text-xs font-black text-rose-700 leading-snug">
                ⚠️ Never send advance deposits before verifying physical product ownership.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">4. Privacy Policies</h4>
            <p>Profile information and WhatsApp numbers provided in settings are publicly listed under product cards to facilitate buyer-seller matching. Password hashes and internal secure access metrics remain highly secure under platform security rules.</p>
          </div>
          <p className="text-[10px] text-slate-400 mt-4 pt-4 border-t border-slate-100 font-mono">
            Last edited: June 2026. Accra, Ghana.
          </p>
        </div>
      )}
    </div>
  );
};
