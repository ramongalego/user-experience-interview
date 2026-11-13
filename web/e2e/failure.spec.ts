// Problem 2, end to end. The simulator is running with FAIL_STEP set to the
// step each test is named for. See scripts/check-failure.sh.
import { expect, test } from '@playwright/test'

test('warm_reagent_plate: a failure says why, and a retry finishes the run', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('start-run').click()

  const failure = page.getByTestId('failure')
  await expect(failure).toContainText('SETPOINT_NOT_REACHED')
  await expect(
    failure,
    'context is shown as the instrument sent it',
  ).toContainText('actual_c')
  await expect(page.getByTestId('run-status')).toContainText('blocked')
  await expect(page, 'the tab shows the run needs someone').toHaveTitle(
    /^Blocked · /,
  )

  const blockedFor = page.getByTestId('blocked-for')
  const firstReading = await blockedFor.textContent()
  await expect(
    blockedFor,
    'the blocked duration keeps counting',
  ).not.toHaveText(firstReading ?? '')

  await page.getByTestId('retry-step').click()

  await expect(page.getByTestId('run-status')).toContainText('completed')
  await expect(page).toHaveTitle(/^Completed · /)
  await expect(blockedFor, 'a finished run is not blocked').toHaveCount(0)
  await expect(
    failure,
    'a retried failure no longer shows as open',
  ).toHaveCount(0)
  await expect(page.getByTestId('retried-failure')).toContainText(
    'retried as attempt 2',
  )
  await expect(
    page.locator('[data-testid=bar][data-step=warm_reagent_plate]'),
    'the retry does not erase the attempt it replaces',
  ).toHaveCount(2)
})

test('read_plate: a failure that cannot be retried offers no retry', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('start-run').click()

  const failure = page.getByTestId('failure')
  await expect(failure).toContainText('CALIBRATION_EXPIRED')
  await expect(failure).toContainText('Retrying will not help')
  await expect(page.getByTestId('retry-step')).toHaveCount(0)
})
