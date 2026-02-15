"""This class contains methods to calculate distance between data points, either in the form of matrices or individual signals."""

import numpy as np
from spectral.algorithms import spatial


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

    # def matrix_pseudodiv_KL(self, A, B, resolution=1., mode=0):
    #     """
    #     Kullback-Leibler pseudo-divergence for spectral data, integration method is
    #     assumed to be trapezoidal.
    #
    #     Parameters:
    #     - `A`: reference matrix, of dimension rowxcolxwavelength.
    #     - `B`: target matrix, of dimension rowxcolxwavelength.
    #     - `mode`: whether to return both components (default, 0), shape(1),
    #         energy(2), or total (summation, 3)
    #
    #     Return: distance matrix, of dimension rowxcol
    #     """
    #     if len(A.shape) == 1:
    #         # This handles pairwise distance with this function as metric callable
    #         A = A[np.newaxis, np.newaxis, :]
    #         B = B[np.newaxis, np.newaxis, :]
    #         # If mode is not setup, by default total klpd is given
    #         if mode == 0:
    #             mode = 3
    #
    #     kA, n_A = self.normalize_spectra(A, get_w=True, resolution=resolution)
    #     kB, n_B = self.normalize_spectra(B, get_w=True, resolution=resolution)
    #     shape = (kA * self.KL(n_A, n_B, resolution=resolution)) + (
    #             kB * self.KL(n_B, n_A, resolution=resolution))
    #     energy = (kA - kB) * (np.log(kA) - np.log(kB))
    #
    #     if mode == 0:
    #         return np.concatenate((shape[:, :, None], energy[:, :, None]), axis=2)
    #     elif mode == 1:
    #         return shape
    #     elif mode == 2:
    #         return energy
    #     else:
    #         return shape + energy
    #
    # def KL(self, A, B, resolution=1.):
    #     """
    #     Kullback-Leibler, the original divergence. Input is assumed to be
    #     normalized to one.
    #
    #     Parameters:
    #     - `A`: reference matrix, of dimension rowxcolxwavelength.
    #     - `B`: target matrix, of dimension rowxcolxwavelength.
    #
    #     Return: divergence matrix, of dimension rowxcol
    #     """
    #     scale = 1e6
    #     #    test = len(A[A==0])+len(B[B==0])
    #     #    if test > 0:
    #     #        print '0 values:', test
    #     part_A = np.nan_to_num(np.log(np.multiply(A, scale)) - np.log(scale))
    #     part_B = np.nan_to_num(np.log(np.multiply(B, scale)) - np.log(scale))
    #     div_KL = np.multiply(A, (part_A - part_B))
    #     return np.trapz(div_KL, dx=resolution, axis=2)

    def normalize_spectra(self, spectra, get_w=False, resolution=None):
        # Normalize spectra for further calculations
        # Dummy implementation for illustration
        k = np.sum(spectra, axis=1, keepdims=True)
        normalized_spectra = spectra / k
        if get_w:
            return k, normalized_spectra
        return normalized_spectra

    def KL(self, p, q, resolution=None):
        # Kullback-Leibler divergence
        kl_div = np.sum(np.multiply(p, np.log(p / q)), axis=1)
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

        shape = np.multiply(kA.flatten(), self.KL(n_A, n_B, resolution=resolution)) + \
                np.multiply(kB.flatten(), self.KL(n_B, n_A, resolution=resolution))

        energy = np.multiply((kA - kB), (np.log(kA) - np.log(kB)))

        # print("2 KL results",  energy.shape, energy, "example values", )
        if mode == 0:
            return np.concatenate((shape[:, None], energy[:, None]), axis=1)
        elif mode == 1:
            return shape
        elif mode == 2:
            return energy
        else:
            return shape + energy

    def calculate_sam(self, pigment, pixel_spectra_list):
        sam_result = np.arccos(1 - (spatial.distance.cosine(pigment, pixel_spectra_list)))
        return sam_result

    def pixel_spectral_angle_mapper(self, pixel1, pixel2):
        """
        Compute the Spectral Angle Mapper (SAM) between two spectral signatures.
        """
        numerator = np.dot(pixel1, pixel2)
        denominator = np.linalg.norm(pixel1) * np.linalg.norm(pixel2)
        angle = np.arccos(numerator / denominator)
        return angle
