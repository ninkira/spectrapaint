import numpy as np
from matplotlib import pyplot as plt
from spectral import imshow
import spectral as sp


# preprocssing: calculate the reflectance through illumination calculation
#    radiance_data = old_man_vnir_img.load()
#    reflectanceCalculationClass = ReflectanceCalculation()
#    file_name ="/reflectance_old_man_warnemünde_04_VNIR_1800_SN00819_18000_us_1x_HSNR03_2016-02-25T142946_raw_rad.hdr"
#    illumination = reflectanceCalculationClass.calculate_illumination(root_path=vnir_root_path, painting_sample_radiance_hsi=old_man_vnir_img, reference_target_hsi=old_man_vnir_reference_img)
#    reflectanceCalculationClass.create_reflectance_hdr_file(radiance_data=radiance_data,illumination=illumination,root_path=vnir_root_path, painting_sample_radiance_hsi=old_man_vnir_img, file_name=file_name)

class ReflectanceCalculation:

    def calculate_illumination(self, painting_sample_radiance_hsi: any, reference_target_hsi: any, root_path: str):
        """
        Calculate illumination for a calibrated radiance hsi from a painting

        :param painting_sample_radiance_hsi:
        :param reference_target_hsi:
        :param root_path:
        :param file_name:
        :return:
        """
        radiance_data = painting_sample_radiance_hsi.load()

        # first step: read the radiance of the calibration target

        # take a sample from the calibration target data and average them to get the illumination
        calibration_target_sample = reference_target_hsi.read_subregion((3300, 3300 + 10),
                                                                        (905, 905 + 10))  # 3D Cube

        # reshape to 2D cube and calculate average to calibration radiance
        calibration_radiance = np.average(calibration_target_sample.reshape(10 * 10, reference_target_hsi.nbands),
                                          axis=0)

        # Second step: get calibration reflection
        calibration_reflectance_csv_path = root_path + "/NEO1_1.CSV"  # first column: wavelength; second column actual reflectance value
        data_csv = np.genfromtxt(calibration_reflectance_csv_path, delimiter=';')

        # interpolation to align the values
        # data_csv[:, 0] - to get the first column of the csv
        interpolation = np.interp(x=reference_target_hsi.bands.centers, xp=data_csv[:, 0], fp=data_csv[:, 1])

        # calculate illumination
        illumination = calibration_radiance / interpolation

        return illumination

    def create_reflectance_hdr_file(self, root_path, radiance_data, illumination, painting_sample_radiance_hsi: any,
                                    file_name: str):

        reflectance_data = (radiance_data) / illumination
        reflectance_metadata = painting_sample_radiance_hsi.metadata.copy()
        reflectance_metadata['data type'] = np.float32

        reflectance_hsi = sp.envi.create_image(root_path + file_name, dtype='float32',
                                               metadata=reflectance_metadata, force=True)
        for i in range(painting_sample_radiance_hsi.nrows):
            for j in range(painting_sample_radiance_hsi.ncols):
                reflectance_hsi._memmap[i, :, j] = painting_sample_radiance_hsi.read_pixel(i, j) / illumination

        reflectance_hsi._memmap.flush()
        imshow(reflectance_hsi)

    def illumination_visualisation(self, reference_img, illumination):
        plt.figure()
        plt.title('Illumination Old Man VNIR')
        plt.plot(reference_img.bands.centers, illumination)
        plt.ylabel('illumination')
        plt.xlabel('Wavelength')
        plt.show()
