// Times imara-diff (intern + diff), median of runs.
//   imara_bench old new [runs]        one file pair
//   imara_bench --corpus dir [runs]   every <n>.old/<n>.new pair in dir, timed as one loop
use imara_diff::{Algorithm, Diff, InternedInput};
use std::time::Instant;

const ALGORITHMS: [(&str, Algorithm); 3] =
    [("myers", Algorithm::Myers), ("myers_minimal", Algorithm::MyersMinimal), ("histogram", Algorithm::Histogram)];

fn diff_once(old: &[u8], new: &[u8], algorithm: Algorithm) -> u64 {
    let input = InternedInput::new(old, new);
    let diff = Diff::compute(algorithm, &input);
    (diff.count_additions() + diff.count_removals()) as u64
}

fn median(mut times: Vec<f64>) -> f64 {
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    times[times.len() / 2]
}

fn one_pair(old: &str, new: &str, runs: usize) {
    let old = std::fs::read(old).unwrap();
    let new = std::fs::read(new).unwrap();
    for (name, algorithm) in ALGORITHMS {
        let mut times = Vec::new();
        let mut edits = 0;
        for _ in 0..runs {
            let start = Instant::now();
            edits = diff_once(&old, &new, algorithm);
            times.push(start.elapsed().as_secs_f64() * 1e3);
        }
        let min = times.iter().cloned().fold(f64::INFINITY, f64::min);
        println!("imara {name} median_ms={:.3} min_ms={:.3} edits={edits}", median(times), min);
    }
}

fn corpus(dir: &str, runs: usize) {
    let count: usize = std::fs::read_to_string(format!("{dir}/count")).unwrap().trim().parse().unwrap();
    let pairs: Vec<(Vec<u8>, Vec<u8>)> = (0..count)
        .map(|i| (std::fs::read(format!("{dir}/{i}.old")).unwrap(), std::fs::read(format!("{dir}/{i}.new")).unwrap()))
        .collect();
    let bytes: usize = pairs.iter().map(|(a, b)| a.len() + b.len()).sum();
    for (name, algorithm) in ALGORITHMS {
        let mut times = Vec::new();
        let mut edits = 0;
        for _ in 0..runs {
            edits = 0;
            let start = Instant::now();
            for (old, new) in &pairs {
                edits += diff_once(old, new, algorithm);
            }
            times.push(start.elapsed().as_secs_f64() * 1e3);
        }
        let t = median(times);
        println!(
            "imara {name} pairs={count} median_ms={t:.2} diffs/s={:.0} MB/s={:.0} edits={edits}",
            count as f64 / t * 1e3,
            bytes as f64 / 1e3 / t
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let runs = |i: usize| args.get(i).map(|r| r.parse().unwrap()).unwrap_or(9);
    if args[1] == "--corpus" {
        corpus(&args[2], runs(3));
    } else {
        one_pair(&args[1], &args[2], runs(3));
    }
}
