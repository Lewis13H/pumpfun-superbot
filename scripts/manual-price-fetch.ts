// scripts/manual-price-fetch.ts - Manually fetch bonding curve data via RPC
import { Connection, PublicKey } from '@solana/web3.js';
import { db } from '../src/database/postgres';
import bs58 from 'bs58';

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 43, 44, 206, 33, 208, 132, 4]);

interface BondingCurveAccount {
  discriminator: Buffer;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  tokenMint: string;
}

function parseBondingCurveAccount(data: Buffer): BondingCurveAccount | null {
  try {
    if (data.length < 121) return null;
    
    const account: BondingCurveAccount = {
      discriminator: data.slice(0, 8),
      virtualTokenReserves: data.readBigUInt64LE(8),
      virtualSolReserves: data.readBigUInt64LE(16),
      realTokenReserves: data.readBigUInt64LE(24),
      realSolReserves: data.readBigUInt64LE(32),
      tokenTotalSupply: data.readBigUInt64LE(40),
      complete: data.readUInt8(48) === 1,
      tokenMint: bs58.encode(data.slice(49, 81))
    };
    
    return account;
  } catch (error) {
    console.error('Error parsing bonding curve:', error);
    return null;
  }
}

function calculatePrice(bondingCurve: BondingCurveAccount): number {
  if (bondingCurve.virtualTokenReserves === 0n) return 0;
  
  const solReserves = Number(bondingCurve.virtualSolReserves) / 1e9;
  const tokenReserves = Number(bondingCurve.virtualTokenReserves) / 1e6;
  
  return solReserves / tokenReserves;
}

async function manualPriceFetch() {
  console.log('\n=== Manual Price Fetch from Solana RPC ===\n');
  
  // Use Helius or another RPC endpoint
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  try {
    // Get tokens with bonding curves
    const tokensWithBC = await db('tokens')
      .whereNotNull('bonding_curve')
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('address', 'symbol', 'bonding_curve', 'last_price_update');
    
    console.log(`Found ${tokensWithBC.length} tokens with bonding curves\n`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const token of tokensWithBC) {
      console.log(`\nChecking token: ${token.address} (${token.symbol})`);
      console.log(`Bonding curve: ${token.bonding_curve}`);
      
      try {
        // Fetch the bonding curve account
        const pubkey = new PublicKey(token.bonding_curve);
        const accountInfo = await connection.getAccountInfo(pubkey);
        
        if (!accountInfo) {
          console.log('❌ Bonding curve account not found on chain!');
          errorCount++;
          continue;
        }
        
        console.log(`✅ Account found - Owner: ${accountInfo.owner.toBase58()}`);
        console.log(`   Data length: ${accountInfo.data.length} bytes`);
        
        // Verify it's owned by Pump program
        if (accountInfo.owner.toBase58() !== PUMP_FUN_PROGRAM) {
          console.log('❌ Account not owned by Pump program!');
          errorCount++;
          continue;
        }
        
        // Parse the data
        const bondingCurve = parseBondingCurveAccount(accountInfo.data);
        
        if (!bondingCurve) {
          console.log('❌ Failed to parse bonding curve data');
          errorCount++;
          continue;
        }
        
        // Verify discriminator
        if (!bondingCurve.discriminator.equals(BONDING_CURVE_DISCRIMINATOR)) {
          console.log('❌ Invalid discriminator');
          errorCount++;
          continue;
        }
        
        // Calculate price
        const priceSol = calculatePrice(bondingCurve);
        const priceUsd = priceSol * 100; // Assuming SOL = $100
        
        const solInCurve = Number(bondingCurve.realSolReserves) / 1e9;
        const totalSupply = Number(bondingCurve.tokenTotalSupply) / 1e6;
        const marketCap = priceUsd * totalSupply;
        const curveProgress = Math.min((solInCurve / 85) * 100, 100);
        
        console.log('✅ Successfully parsed bonding curve!');
        console.log(`   Token Mint: ${bondingCurve.tokenMint}`);
        console.log(`   Price: ${priceSol.toFixed(6)} SOL ($${priceUsd.toFixed(6)})`);
        console.log(`   Market Cap: $${marketCap.toFixed(2)}`);
        console.log(`   SOL in curve: ${solInCurve.toFixed(2)} SOL`);
        console.log(`   Progress: ${curveProgress.toFixed(2)}%`);
        console.log(`   Complete: ${bondingCurve.complete}`);
        
        // Check if this matches the token address
        if (bondingCurve.tokenMint !== token.address) {
          console.log(`⚠️  WARNING: Token mint mismatch!`);
          console.log(`   Expected: ${token.address}`);
          console.log(`   Got: ${bondingCurve.tokenMint}`);
        }
        
        successCount++;
        
        // Save this price to database
        if (priceSol > 0 && marketCap > 0) {
          console.log('\n   Saving price to database...');
          
          try {
            // Update token
            await db('tokens')
              .where('address', token.address)
              .update({
                current_price_usd: priceUsd,
                current_price_sol: priceSol,
                market_cap: marketCap,
                liquidity: solInCurve,
                curve_progress: curveProgress,
                last_price_update: new Date(),
                updated_at: new Date()
              });
            
            // Insert price record
            await db('timeseries.token_prices').insert({
              token_address: token.address,
              time: new Date(),
              price_usd: priceUsd,
              price_sol: priceSol,
              virtual_sol_reserves: bondingCurve.virtualSolReserves.toString(),
              virtual_token_reserves: bondingCurve.virtualTokenReserves.toString(),
              real_sol_reserves: bondingCurve.realSolReserves.toString(),
              real_token_reserves: bondingCurve.realTokenReserves.toString(),
              market_cap: marketCap,
              liquidity_usd: solInCurve * 100 * 2,
              slot: 0,
              source: 'manual'
            });
            
            console.log('   ✅ Price saved!');
          } catch (error) {
            console.error('   ❌ Error saving price:', error);
          }
        }
        
      } catch (error) {
        console.error(`❌ Error fetching bonding curve:`, error);
        errorCount++;
      }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Successfully fetched: ${successCount}/${tokensWithBC.length}`);
    console.log(`Errors: ${errorCount}`);
    
    // Check if we now have price records
    const priceCount = await db('timeseries.token_prices').count('* as count');
    console.log(`\nTotal price records in database: ${priceCount[0].count}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await db.destroy();
  }
}

// Run manual fetch
manualPriceFetch();