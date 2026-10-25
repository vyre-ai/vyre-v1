;; S13 vector kernel (ARCH R14): scores `count` vectors of 384 float32 against one query, out[i] = dot(vector i, q).
;; Vectors lie end to end from `vec`; q is 384 floats at `q`; the scores are written as float32 from `out`. All three are byte addresses in the imported memory.
;; Eight floats per turn of the inner loop: two independent v128 accumulators, so the adds do not wait on each other. 384 = 48 turns, no tail.
;; Assembled on the runner by spikes/s13/assemble.ts (wabt, simd on). Nothing here is hand-encoded.
(module
  (import "e" "m" (memory 1))

  (func (export "scan") (param $vec i32) (param $q i32) (param $count i32) (param $out i32)
    (local $acc0 v128) (local $acc1 v128)
    (local $qp i32) (local $qend i32) (local $end i32)

    ;; end = out + count * 4 ; qend = q + 384 * 4
    (local.set $end (i32.add (local.get $out) (i32.shl (local.get $count) (i32.const 2))))
    (local.set $qend (i32.add (local.get $q) (i32.const 1536)))

    (block $done
      (loop $next_vector
        (br_if $done (i32.ge_u (local.get $out) (local.get $end)))
        (local.set $acc0 (v128.const i32x4 0 0 0 0))
        (local.set $acc1 (v128.const i32x4 0 0 0 0))
        (local.set $qp (local.get $q))

        (loop $next_eight
          (local.set $acc0 (f32x4.add (local.get $acc0)
            (f32x4.mul (v128.load offset=0 (local.get $vec)) (v128.load offset=0 (local.get $qp)))))
          (local.set $acc1 (f32x4.add (local.get $acc1)
            (f32x4.mul (v128.load offset=16 (local.get $vec)) (v128.load offset=16 (local.get $qp)))))
          (local.set $vec (i32.add (local.get $vec) (i32.const 32)))
          (local.set $qp (i32.add (local.get $qp) (i32.const 32)))
          (br_if $next_eight (i32.lt_u (local.get $qp) (local.get $qend))))

        (local.set $acc0 (f32x4.add (local.get $acc0) (local.get $acc1)))
        (f32.store (local.get $out)
          (f32.add
            (f32.add (f32x4.extract_lane 0 (local.get $acc0)) (f32x4.extract_lane 1 (local.get $acc0)))
            (f32.add (f32x4.extract_lane 2 (local.get $acc0)) (f32x4.extract_lane 3 (local.get $acc0)))))
        (local.set $out (i32.add (local.get $out) (i32.const 4)))
        (br $next_vector))))
)
