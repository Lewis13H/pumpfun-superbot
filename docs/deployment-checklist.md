# Deployment Checklist - Category System v1

## Pre-Deployment

### Code Preparation
- [ ] All tests passing
- [ ] Code review completed
- [ ] Documentation updated
- [ ] Environment variables documented
- [ ] Dependencies updated

### Database Preparation
- [ ] Backup production database
- [ ] Test migration on staging
- [ ] Verify rollback procedure
- [ ] Check index performance
- [ ] Estimate migration time

### System Requirements
- [ ] Memory requirements verified (4GB+ recommended)
- [ ] Disk space available
- [ ] API rate limits confirmed
- [ ] Network connectivity stable

## Deployment Steps

### 1. Preparation (30 min before)
- [ ] Notify team of deployment
- [ ] Create database backup
- [ ] Pull latest code
- [ ] Install dependencies
- [ ] Build TypeScript

### 2. Stop Services (5 min)
- [ ] Stop discovery service
- [ ] Stop enrichment service
- [ ] Stop API server
- [ ] Verify all processes stopped

### 3. Database Migration (10-30 min)
- [ ] Run migration script
- [ ] Verify schema changes
- [ ] Check for errors
- [ ] Run verification queries

### 4. Start Services (10 min)
- [ ] Start discovery service
- [ ] Verify state machines created
- [ ] Start scan scheduler
- [ ] Start API server
- [ ] Start buy signal service

### 5. Verification (15 min)
- [ ] Check category distribution
- [ ] Verify state transitions working
- [ ] Test API endpoints
- [ ] Monitor WebSocket events
- [ ] Check error logs

### 6. Monitoring (2 hours)
- [ ] Watch for stuck tokens
- [ ] Monitor API costs
- [ ] Check memory usage
- [ ] Verify scan frequencies
- [ ] Monitor buy signals

## Rollback Plan

If issues occur:

1. **Stop all services**
2. **Run rollback script**
3. **Restore from backup if needed**
4. **Start old version**
5. **Verify functionality**

## Post-Deployment

### Immediate (First 24 hours)
- [ ] Monitor error rates
- [ ] Check API costs
- [ ] Verify buy signal accuracy
- [ ] Watch for performance issues
- [ ] Document any issues

### Week 1
- [ ] Analyze category flow
- [ ] Tune thresholds if needed
- [ ] Review buy signal success
- [ ] Optimize scan frequencies
- [ ] Gather team feedback

### Documentation
- [ ] Update runbooks
- [ ] Document new procedures
- [ ] Update monitoring guides
- [ ] Create troubleshooting guide

## Success Criteria

- ✅ All tokens categorized
- ✅ State machines active
- ✅ Scans running per schedule
- ✅ Buy signals generating
- ✅ API costs under budget
- ✅ No critical errors

## Emergency Contacts

- Lead Developer: [Contact]
- Database Admin: [Contact]
- On-Call Engineer: [Contact]
