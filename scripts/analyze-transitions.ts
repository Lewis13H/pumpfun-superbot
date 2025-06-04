import { db } from '../src/database/postgres';
import { TokenCategory } from '../src/config/category-config';

async function analyzeTransitions() {
  console.log('=== Category Transition Analysis ===\n');
  
  // Get transition matrix
  const transitions = await db('category_transitions')
    .select('from_category', 'to_category')
    .count('* as count')
    .groupBy('from_category', 'to_category')
    .orderBy('count', 'desc');
  
  // Build matrix
  const categories: TokenCategory[] = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE', 'BIN'];
  const matrix: Record<string, Record<string, number>> = {};
  
  categories.forEach(from => {
    matrix[from] = {};
    categories.forEach(to => {
      matrix[from][to] = 0;
    });
  });
  
  transitions.forEach(t => {
    if (t.from_category && t.to_category) {
      matrix[t.from_category][t.to_category] = Number(t.count);
    }
  });
  
  console.log('Transition Matrix:');
  console.log('FROM\\TO', categories.join('\t'));
  categories.forEach(from => {
    const row = categories.map(to => matrix[from][to] || 0).join('\t');
    console.log(`${from}\t${row}`);
  });
  
  // Average time in each category - FIXED VERSION
  console.log('\n\nAverage Time in Category:');
  
  for (const category of categories) {
    if (category === 'BIN') continue;
    
    try {
      // Get tokens that transitioned FROM this category
      const avgTime = await db('category_transitions as ct1')
        .join('category_transitions as ct2', function() {
          this.on('ct1.token_address', '=', 'ct2.token_address')
            .andOn(db.raw('ct2.created_at > ct1.created_at'));
        })
        .where('ct1.from_category', category)
        .select(db.raw('AVG(EXTRACT(EPOCH FROM (ct2.created_at - ct1.created_at))) as avg_seconds'))
        .first();
      
      if (avgTime && avgTime.avg_seconds) {
        const hours = Math.round(Number(avgTime.avg_seconds) / 3600);
        console.log(`  ${category}: ${hours} hours`);
      } else {
        console.log(`  ${category}: No data`);
      }
    } catch (error) {
      console.log(`  ${category}: Error calculating`);
    }
  }
  
  // Success paths
  console.log('\n\nSuccess Paths (reached AIM):');
  
  const aimTokens = await db('category_transitions')
    .where('to_category', 'AIM')
    .select('token_address')
    .distinct();
  
  const pathCounts: Record<string, number> = {};
  
  for (const token of aimTokens) {
    const path = await db('category_transitions')
      .where('token_address', token.token_address)
      .orderBy('created_at', 'asc')
      .select('from_category', 'to_category');
    
    const pathStr = path
      .map(p => p.to_category)
      .filter(c => c !== 'AIM')
      .concat(['AIM'])
      .join(' → ');
    
    pathCounts[pathStr] = (pathCounts[pathStr] || 0) + 1;
  }
  
  Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([path, count]) => {
      console.log(`  ${path}: ${count} tokens`);
    });
  
  // Market cap at transitions
  console.log('\n\nAverage Market Cap at Transitions:');
  
  const mcTransitions = await db('category_transitions')
    .select('to_category')
    .avg('market_cap_at_transition as avg_mc')
    .whereNotNull('market_cap_at_transition')
    .groupBy('to_category')
    .orderBy('to_category');
  
  mcTransitions.forEach(t => {
    console.log(`  → ${t.to_category}: $${Math.round(Number(t.avg_mc))}`);
  });
}

analyzeTransitions()
  .then(() => process.exit(0))
  .catch(console.error);