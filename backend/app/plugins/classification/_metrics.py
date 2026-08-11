"""Distance computations shared by the classification plug-ins.

Underscore-prefixed because it is the plug-ins' private implementation, not an extension point:
`sam.py`, `cosine.py` and `klpd.py` are what the registry knows about.
"""

import numpy as np


def tile_query(query: np.ndarray, library: np.ndarray) -> np.ndarray:
    """Repeat a (B,) query into (N, B) so it can be compared row-wise against a library.

    The matrix metrics below compare corresponding rows of two equally shaped matrices, so the
    query has to be broadcast to the library's height first.
    """
    return np.repeat(np.asarray(query, dtype=float)[None, :], library.shape[0], axis=0)


class DistanceMetrics:

    def matrix_spectral_angle_mapper(self, A, B):
        """
        Compute the Spectral Angle Mapper (SAM) between two matrices.
        A : numpy.ndarray
            First matrix of spectra (m x n) - m (rows) = pigment; n (cols) = wavelengths
        B : numpy.ndarray
            Second matrix of spectra (m x n).

        Returns:
        numpy.ndarray
            Array of spectral angles (m).
        """
        # Normalize the matrices row-wise
        A_norm = A / np.linalg.norm(A, axis=1, keepdims=True)
        B_norm = B / np.linalg.norm(B, axis=1, keepdims=True)

        # Compute the dot product between corresponding rows
        dot_product = np.einsum('ij,ij->i', A_norm, B_norm)

        # Ensure values are within valid range for arccos due to numerical errors
        dot_product = np.clip(dot_product, -1.0, 1.0)

        # Compute the spectral angle
        spectral_angles = np.arccos(dot_product)

        return spectral_angles

    def matrix_cosine_distance(self, matrix_a, matrix_b):
        # Ensure the matrices have the same shape
        if matrix_a.shape != matrix_b.shape:
            raise ValueError("Both matrices must have the same shape")

        # Compute dot product for each pair of corresponding rows
        dot_product = np.einsum('ij,ij->i', matrix_a, matrix_b)

        # Compute the norms of each row
        norm_a = np.linalg.norm(matrix_a, axis=1)
        norm_b = np.linalg.norm(matrix_b, axis=1)

        # Compute cosine similarity
        cosine_similarity = dot_product / (norm_a * norm_b)

        # Compute cosine distance
        cosine_distance = 1 - cosine_similarity

        return cosine_distance

    def normalize_spectra(self, spectra, get_w=False, resolution=None):
        # Normalize spectra for further calculations
        k = np.sum(spectra, axis=1, keepdims=True)
        # Guard against zero-sum spectra to avoid divide-by-zero and NaNs.
        safe_k = np.where(np.abs(k) <= np.finfo(float).eps, 1.0, k)
        normalized_spectra = spectra / safe_k
        if get_w:
            return safe_k, normalized_spectra
        return normalized_spectra

    def KL(self, p, q, resolution=None):
        # Kullback-Leibler divergence
        eps = np.finfo(float).eps
        p_safe = np.clip(p, eps, None)
        q_safe = np.clip(q, eps, None)
        kl_div = np.sum(np.multiply(p_safe, np.log(p_safe / q_safe)), axis=1)
        return kl_div

    def klpd_spectral(self, A, B, mode=2, resolution=None):
        """
        Kullback-Leibler pseudo-divergence for spectral data, integration method is
        assumed to be trapezoidal.

        Parameters:
        - `A`: reference matrix, of dimension 1592x182.
        - `B`: target matrix, of dimension 1592x182.
        - `mode`: whether to return both components (default, 0), shape(1),
            energy(2), or total (summation, 3)

        Return: distance matrix, of dimension 1592x182
        """
        A = np.array(A)
        B = np.array(B)


        if len(A.shape) == 1:
            # Handle pairwise distance with this function as metric callable
            A = A[np.newaxis, :]
            B = B[np.newaxis, :]
            # If mode is not set, default to total klpd
            if mode == 0:
                mode = 3

        kA, n_A = self.normalize_spectra(A, get_w=True, resolution=resolution)
        kB, n_B = self.normalize_spectra(B, get_w=True, resolution=resolution)

        # shape = (kA * self.KL(n_A, n_B, resolution=resolution)) + (kB * self.KL(n_B, n_A, resolution=resolution))

        kA_1d = kA.flatten()
        kB_1d = kB.flatten()
        shape = np.multiply(kA_1d, self.KL(n_A, n_B, resolution=resolution)) + \
                np.multiply(kB_1d, self.KL(n_B, n_A, resolution=resolution))

        eps = np.finfo(float).eps
        kA_safe = np.clip(kA_1d, eps, None)
        kB_safe = np.clip(kB_1d, eps, None)
        # Keep 1D shape aligned with `shape` (one score per row).
        energy = np.multiply((kA_safe - kB_safe), (np.log(kA_safe) - np.log(kB_safe)))

        # print("2 KL results",  energy.shape, energy, "example values", )
        if mode == 0:
            return np.concatenate((shape[:, None], energy[:, None]), axis=1)
        elif mode == 1:
            return shape
        elif mode == 2:
            return energy
        else:
            return shape + energy

    def pixel_spectral_angle_mapper(self, pixel1, pixel2):
        """
        Compute the Spectral Angle Mapper (SAM) between two spectral signatures.
        """
        numerator = np.dot(pixel1, pixel2)
        denominator = np.linalg.norm(pixel1) * np.linalg.norm(pixel2)
        angle = np.arccos(numerator / denominator)
        return angle
