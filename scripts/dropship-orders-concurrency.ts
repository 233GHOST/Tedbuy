// Staging-only check that stock holds can't oversell under real concurrency (PGlite tests
// run on one connection, so they can't). Creates synthetic users and records whose ids start
// with 'zzconc_' on the STAGING database, puts one unit in stock, makes 8 orders for it, and
// has the supplier confirm all 8 holds at the same moment. Exactly one may succeed. Then a
// second reseller with a 2,500-pesewa open limit requests four 1,000-pesewa holds at once:
// exactly two may pass.
//
//   npx tsx scripts/dropship-orders-concurrency.ts
//
// Refuses to run unless SUPABASE_URL is the staging project (DROPSHIP_STAGING_REF, default
// djlvwjkrcsfpxfjovelc) and never runs against the live project. Synthetic rows are left in
// place (orders and their history are append-only by design); they are clearly named.
import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = process.env.DROPSHIP_STAGING_REF || 'djlvwjkrcsfpxfjovelc';
const LIVE_REF = 'hnfqymkdgadwzrjenaqf';
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
if (host !== `${STAGING_REF}.supabase.co` || host.startsWith(LIVE_REF) || !key) {
  console.error('Refusing: SUPABASE_URL must be the staging project and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw Object.assign(new Error(`${fn}: ${error.message} ${error.details ?? ''}`), { pg: error });
  return data as any;
}

const run = `zzconc_${Date.now().toString(36)}`;
const supplier = `${run}_sup`, reseller = `${run}_res`;
const buyers = Array.from({ length: 8 }, (_, i) => `${run}_buy${i}`);
const IMG = 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/concurrency-test.jpg';

async function main() {
  const { error: uErr } = await sb.from('users').insert([supplier, reseller, ...buyers].map(id => ({ id, username: id })));
  if (uErr) throw new Error(`creating synthetic users failed: ${uErr.message}`);
  for (const [user, kind] of [[supplier, 'supplier'], [reseller, 'dropshipper']] as const) {
    const app = await rpc('dropship_submit_application', { p_user: user, p_kind: kind, p_client_request_id: crypto.randomUUID(), p_fields: {
      displayName: `Concurrency ${kind}`, contactPhone: '0240000000', region: 'Greater Accra', city: 'Accra',
      addressLine: 'Synthetic test address', termsVersion: 'test' } });
    await rpc('dropship_admin_decide_participation', { p_admin: 'zzconc_admin', p_participant_id: app.participant.id, p_decision: 'approve',
      p_reason: null, p_notes: 'synthetic concurrency test', p_expected_status: 'pending' });
  }
  const sp = await rpc('dropship_create_supplier_product', { p_actor: supplier, p_actor_role: 'supplier', p_supplier_id: supplier,
    p_submit: true, p_client_request_id: crypto.randomUUID(), p_reason: null, p_fields: {
      title: 'Concurrency test item', description: 'Synthetic item for the stock-hold race test.', category: 'Electronics',
      images: [IMG], wholesalePricePesewas: 1000, stockOnHand: 8, maxPerOrder: 1, shipsFromRegion: 'Greater Accra',
      shipsFromCity: 'Accra', deliveryFeeSameRegionPesewas: 0, leadTimeMinDays: 1, leadTimeMaxDays: 2 } });
  await rpc('dropship_admin_moderate_supplier_product', { p_admin: 'zzconc_admin', p_id: sp.product.id, p_decision: 'approve', p_reason: null });
  const listing = await rpc('dropship_create_listing', { p_actor: reseller, p_supplier_product_id: sp.product.id, p_retail_pesewas: 2000, p_client_request_id: crypto.randomUUID() });
  // A generous limit so the reseller's open-orders cap isn't what stops the test.
  await rpc('dropship_admin_set_limit_override', { p_admin: 'zzconc_admin', p_user: reseller, p_per_order: 100000, p_open: 1000000, p_reason: 'synthetic concurrency test' });

  const orders: string[] = [];
  for (const b of buyers) {
    const o = await rpc('dropship_place_order', { p_buyer: b, p_buyer_email: null, p_product_id: listing.productId, p_quantity: 1,
      p_client_request_id: crypto.randomUUID(), p_delivery: { name: 'Synthetic Buyer', phone: '0550000000', region: 'Greater Accra', area: 'Osu', address: 'Synthetic address 1' } });
    await rpc('dropship_buyer_order_action', { p_buyer: b, p_order: o.order.id, p_action: 'confirm', p_input: {} });
    await rpc('dropship_reseller_order_action', { p_actor: reseller, p_order: o.order.id, p_action: 'accept', p_input: {} });
    await rpc('dropship_reseller_order_action', { p_actor: reseller, p_order: o.order.id, p_action: 'request_reservation', p_input: {} });
    orders.push(o.order.id);
  }
  // Leave one unit: the 8 holds now race for it.
  const current = (await sb.from('dropship_supplier_products').select('stock_on_hand').eq('id', sp.product.id).single()).data!;
  await rpc('dropship_set_stock', { p_actor: supplier, p_actor_role: 'supplier', p_id: sp.product.id, p_new_on_hand: 1, p_expected_on_hand: current.stock_on_hand, p_reason: 'race test' });

  const results = await Promise.allSettled(orders.map(id =>
    rpc('dropship_supplier_order_action', { p_actor: supplier, p_order: id, p_action: 'confirm_reservation', p_input: {} })));
  const won = results.filter(r => r.status === 'fulfilled').length;
  const after = (await sb.from('dropship_supplier_products').select('stock_on_hand, stock_reserved').eq('id', sp.product.id).single()).data!;
  console.log(`holds confirmed: ${won} of ${orders.length}; stock on hand ${after.stock_on_hand}, held ${after.stock_reserved}`);
  for (const r of results) if (r.status === 'rejected') console.log('  refused:', String((r.reason as Error).message).slice(0, 120));
  if (won !== 1 || after.stock_reserved !== 1) {
    console.error('FAIL: stock was oversold or nothing could be held.');
    process.exit(1);
  }

  // Part 2: a reseller's open-orders limit under real concurrency. Limit 2,500 pesewas, four
  // accepted orders of 1,000 each ask for a hold at the same moment: exactly two may pass.
  const reseller2 = `${run}_res2`;
  await sb.from('users').insert({ id: reseller2, username: reseller2 });
  const app2 = await rpc('dropship_submit_application', { p_user: reseller2, p_kind: 'dropshipper', p_client_request_id: crypto.randomUUID(), p_fields: {
    displayName: 'Concurrency dropshipper 2', contactPhone: '0240000000', region: 'Greater Accra', city: 'Accra', termsVersion: 'test' } });
  await rpc('dropship_admin_decide_participation', { p_admin: 'zzconc_admin', p_participant_id: app2.participant.id, p_decision: 'approve',
    p_reason: null, p_notes: 'synthetic concurrency test', p_expected_status: 'pending' });
  await rpc('dropship_set_stock', { p_actor: supplier, p_actor_role: 'supplier', p_id: sp.product.id, p_new_on_hand: 20, p_expected_on_hand: 1, p_reason: 'limit race test' });
  const listing2 = await rpc('dropship_create_listing', { p_actor: reseller2, p_supplier_product_id: sp.product.id, p_retail_pesewas: 2000, p_client_request_id: crypto.randomUUID() });
  await rpc('dropship_admin_set_limit_override', { p_admin: 'zzconc_admin', p_user: reseller2, p_per_order: 2500, p_open: 2500, p_reason: 'synthetic limit race test' });
  const orders2: string[] = [];
  for (const b of buyers.slice(0, 4)) {
    const o = await rpc('dropship_place_order', { p_buyer: b, p_buyer_email: null, p_product_id: listing2.productId, p_quantity: 1,
      p_client_request_id: crypto.randomUUID(), p_delivery: { name: 'Synthetic Buyer', phone: '0550000000', region: 'Greater Accra', area: 'Osu', address: 'Synthetic address 1' } });
    await rpc('dropship_buyer_order_action', { p_buyer: b, p_order: o.order.id, p_action: 'confirm', p_input: {} });
    await rpc('dropship_reseller_order_action', { p_actor: reseller2, p_order: o.order.id, p_action: 'accept', p_input: {} });
    orders2.push(o.order.id);
  }
  const results2 = await Promise.allSettled(orders2.map(id =>
    rpc('dropship_reseller_order_action', { p_actor: reseller2, p_order: id, p_action: 'request_reservation', p_input: {} })));
  const passed = results2.filter(r => r.status === 'fulfilled').length;
  console.log(`limit race: ${passed} of ${orders2.length} holds requested (limit allows 2)`);
  for (const r of results2) if (r.status === 'rejected') console.log('  refused:', String((r.reason as Error).message).slice(0, 120));
  if (passed !== 2) {
    console.error('FAIL: the open-orders limit was exceeded or wrongly refused.');
    process.exit(1);
  }
  console.log(`PASS (synthetic run id ${run})`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
