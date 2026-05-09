import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { name?: string; email?: string; role?: string; firmName?: string };

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-900 mb-4">Account</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex">
            <dt className="w-32 text-slate-500">Name</dt>
            <dd className="text-slate-900">{user?.name}</dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-slate-500">Email</dt>
            <dd className="text-slate-900">{user?.email}</dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-slate-500">Role</dt>
            <dd className="text-slate-900 capitalize">{user?.role?.replace('_', ' ')}</dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-slate-500">Firm</dt>
            <dd className="text-slate-900">{user?.firmName}</dd>
          </div>
        </dl>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-900 mb-4">Data & Compliance</h2>
        <div className="space-y-2 text-sm text-slate-600">
          <p>✓ Data stored in AWS eu-west-2 (London) region</p>
          <p>✓ All data encrypted at rest (AES-256) and in transit (TLS 1.3)</p>
          <p>✓ Row-level security isolates firm data</p>
          <p>✓ GDPR / DPA 2018 compliant processing</p>
          <p>✓ SRA AI guidance disclosure applied to all outputs</p>
          <p>✓ Session timeout: 8 hours</p>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <p className="text-xs text-slate-500">
          MedChron AI v1.0 · For support contact <a href="mailto:support@medchron.ai" className="text-blue-600 hover:underline">support@medchron.ai</a>
        </p>
      </div>
    </div>
  );
}
