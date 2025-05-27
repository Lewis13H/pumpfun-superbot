"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const postgres_1 = require("../src/database/postgres");
const logger_1 = require("../src/utils/logger");
async function checkAnalysis() {
    // Get token counts by status
    const tokensByStatus = await (0, postgres_1.db)('tokens')
        .select('analysis_status')
        .count('* as count')
        .groupBy('analysis_status');
    logger_1.logger.info('Tokens by analysis status:', tokensByStatus);
    // Get recent analyses
    const recentAnalyses = await (0, postgres_1.db)('token_analysis_history')
        .orderBy('analyzed_at', 'desc')
        .limit(5)
        .select('token_address', 'composite_score', 'analyzed_at');
    logger_1.logger.info('Recent analyses:', recentAnalyses);
    // Get token classifications
    const classifications = await (0, postgres_1.db)('tokens')
        .select('investment_classification')
        .count('* as count')
        .whereNotNull('investment_classification')
        .groupBy('investment_classification');
    logger_1.logger.info('Token classifications:', classifications);
    process.exit(0);
}
checkAnalysis().catch(console.error);
//# sourceMappingURL=check-analysis.js.map