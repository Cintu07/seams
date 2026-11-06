// Times imara-diff (intern + diff) on one file pair; prints median ms and edit size.
use imara_diff::{Algorithm, Diff, InternedInput};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let old = std::fs::read(&args[1]).unwrap();
    let new = std::fs::read(&args[2]).unwrap();
    let runs: usize = args.get(3).map(|r| r.parse().unwrap()).unwrap_or(9);
    for (name, algorithm) in [("myers", Algorithm::Myers), ("myers_minimal", Algorithm::MyersMinimal), ("histogram", Algorithm::Histogram)] {
        let mut times = Vec::new();
        let mut edits = 0u32;
        for _ in 0..runs {
            let start = Instant::now();
            let input = InternedInput::new(&old[..], &new[..]);
            let diff = Diff::compute(algorithm, &input);
            edits = diff.count_additions() + diff.count_removals();
            times.push(start.elapsed().as_secs_f64() * 1e3);
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("imara {name} median_ms={:.3} min_ms={:.3} edits={edits}", times[times.len() / 2], times[0]);
    }
}
