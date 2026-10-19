# Chrome Web Store releases

Open **Actions → Chrome Web Store → Run workflow**, select `main`, and choose:

- `status` (default): authenticate and read store status without uploading.
- `upload`: run tests, build the ZIP, and upload it without submitting for review.
- `publish`: run tests, upload the ZIP, and submit it for review and publication on approval.

For `upload` and `publish`, enter the exact `manifest.json` version. Increase it before
each update. An existing pending or staged submission blocks an upload; the workflow
does not cancel or replace it. `publish` uploads too, so after an `upload` run, inspect
and submit that draft in the developer dashboard rather than assuming `publish` is
a submit-only operation. A successful workflow does not mean the store review passed.

Authentication uses Google Workload Identity Federation through a service account.
No service account key or refresh token is stored in GitHub. The provider admits only
manual workflows from `main` in `snowmuffin/cooldown-for-chatgpt` (repository ID
`1424360204`, owner ID `77647785`). Tags and pull requests cannot publish.

Repository Actions variables:

| Name | Meaning |
| --- | --- |
| `GCP_PROJECT_ID` | Google Cloud project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full `projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` path |
| `GCP_SERVICE_ACCOUNT` | Service account email registered in the store dashboard |
| `CWS_PUBLISHER_ID` | Store publisher ID |
| `CWS_EXTENSION_ID` | Store item ID, which can differ from an unpacked extension ID |

The Google project needs Chrome Web Store API and IAM Service Account Credentials
API enabled. The repository identity has `roles/iam.workloadIdentityUser` on the
publishing service account. The requested access token scope is
`https://www.googleapis.com/auth/chromewebstore`.

References: [store service accounts](https://developer.chrome.com/docs/webstore/service-accounts),
[store API](https://developer.chrome.com/docs/webstore/using-api),
[Google GitHub authentication](https://github.com/google-github-actions/auth).
