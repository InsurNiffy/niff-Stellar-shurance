# Claim Review Step Implementation

## Overview
This implementation adds a mandatory review step to the claim filing wizard, ensuring users verify all claim details before signing the transaction with their wallet.

## Changes Made

### 1. Review Step Component (`ReviewStep.tsx`)
- **Location**: `frontend/src/components/claims/steps/ReviewStep.tsx`
- **Features**:
  - Displays formatted claim amount with proper token decimals
  - Shows complete narrative/incident description
  - Lists all evidence files with names and SHA-256 hashes
  - Displays policy coverage details (amount, status, expiry)
  - Provides "Edit" buttons for each section that navigate back to the relevant step
  - Includes clear call-to-action for wallet signing

### 2. Wizard Integration (`ClaimWizard.tsx`)
- **Location**: `frontend/src/components/claims/ClaimWizard.tsx`
- **Implementation Details**:
  - Review step added as Step 4 (penultimate before signing)
  - Steps: Amount → Narrative → Evidence → **Review** → Sign
  - State-based navigation prevents URL manipulation
  - "Confirm & Sign" button only appears on review step
  - Edit navigation preserves all form data via React state
  - Signing flow (`handleFinalSubmit`) only triggered from review step

### 3. Security Features
- **URL Manipulation Prevention**: 
  - Wizard uses internal `activeStep` state (not URL parameters)
  - Users must progress sequentially through steps
  - Cannot skip directly to signing via URL manipulation
  
- **Data Preservation**:
  - All form data stored in `formData` state object
  - Edit navigation uses `setActiveStep()` without clearing data
  - Draft persistence maintains data across sessions

### 4. Testing
- **Unit Tests**: `ReviewStep.test.tsx`
  - Verifies all claim data renders correctly
  - Tests edit button functionality
  - Validates policy coverage display
  - Checks empty evidence handling
  
- **Integration Tests**: `ClaimWizard.test.tsx`
  - Confirms review step is penultimate before signing
  - Validates sequential navigation requirement
  - Tests edit navigation preserves field values
  - Verifies signing only occurs from review step
  - Confirms URL manipulation prevention

## Acceptance Criteria Met

✅ **Review step as penultimate step**: Step 4 of 4, before wallet signing  
✅ **Display all inputs**: Amount (formatted), evidence files/hashes, policy coverage  
✅ **Edit links preserve values**: `onEdit` callback navigates without data loss  
✅ **Confirm & Sign only from review**: Button text changes, signing gated by step check  
✅ **Unit tests**: Comprehensive tests verify review step rendering  
✅ **Manual testing ready**: All inputs visible, edit navigation works correctly  
✅ **URL manipulation prevented**: State-based navigation, no URL parameters  

## User Flow

1. User enters claim amount → Next
2. User writes incident narrative → Next
3. User uploads evidence files → Next
4. **User reviews all details on summary screen**
   - Can click "Edit" on any section to go back
   - All other field values preserved when editing
5. User clicks "Confirm & Sign" → Wallet prompt appears
6. User signs transaction in wallet
7. Transaction submitted to blockchain

## Technical Notes

- Review step receives `formData` as props from parent wizard
- `onEdit` callback accepts step index (0=Amount, 1=Narrative, 2=Evidence)
- Policy coverage details are optional (gracefully handles missing data)
- Token formatting uses `formatTokenAmount` utility with configurable decimals
- Evidence hashes displayed with truncation for readability (first 16 + last 8 chars)

## Files Modified

- `frontend/src/components/claims/ClaimWizard.tsx` - Added review step integration
- `frontend/src/components/claims/steps/ReviewStep.tsx` - Review step component (already existed)
- `frontend/src/hooks/useTransactionStatus.ts` - Fixed template literal syntax

## Files Created

- `frontend/src/components/claims/__tests__/ClaimWizard.test.tsx` - Integration tests
- `IMPLEMENTATION.md` - This documentation

## Testing Commands

```bash
# Run all tests
npm test

# Run specific test file
npm test ReviewStep.test.tsx
npm test ClaimWizard.test.tsx

# Type checking
npm run typecheck

# Linting
npm run lint

# Build verification
npm run build
```

## Manual Testing Checklist

- [ ] Navigate through all wizard steps sequentially
- [ ] Verify review step shows correct amount, narrative, and evidence
- [ ] Click "Edit" on amount - verify returns to step 1 with data preserved
- [ ] Click "Edit" on narrative - verify returns to step 2 with data preserved
- [ ] Click "Edit" on evidence - verify returns to step 3 with data preserved
- [ ] Complete wizard and verify "Confirm & Sign" only appears on review step
- [ ] Attempt to skip steps - verify sequential navigation is enforced
- [ ] Verify wallet signing prompt only appears after clicking "Confirm & Sign" on review step
