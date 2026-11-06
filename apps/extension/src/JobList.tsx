import type { StoredJob } from "./jobs/jobStore.ts";
import { formatPlayed } from "./format.ts";
import { strings } from "./strings.ts";

const s = strings.jobs;

/** Every Job run, newest first, with how far it got. */
export function JobList({ jobs }: { jobs: StoredJob[] }) {
  return (
    <div className="job-list">
      <h1>{s.heading}</h1>
      {jobs.length === 0 ? (
        <p className="rs-hint">{s.empty}</p>
      ) : (
        <table className="rs-table">
          <thead>
            <tr>
              <th className="rs-col-time">{s.columns.started}</th>
              <th>{s.columns.job}</th>
              <th>{s.columns.progress}</th>
              <th>{s.columns.state}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const done = job.entries.filter((e) => e.status === "done").length;
              return (
                <tr key={job.id}>
                  <td className="rs-col-time">{formatPlayed(Math.floor(job.createdAt / 1000))}</td>
                  <td>{s.describe(job.kind, strings.preview.count(job.entries.length))}</td>
                  <td className="rs-num">{done} / {job.entries.length}</td>
                  <td>{s.states[job.state]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
