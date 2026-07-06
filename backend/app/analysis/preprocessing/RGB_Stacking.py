import numpy as np


class RGBStacking:
    def create_rgb_render(self, hsi, metadata):
        print("Create radiance RGB img from default bands")
        default_bands = metadata.get('default bands')
        print("default bands", default_bands, type(default_bands), )

        # get data from default bands
        r_channel = hsi.read_band(int(default_bands[0]))
        g_channel = hsi.read_band(int(default_bands[1]))
        b_channel = hsi.read_band(int(default_bands[2]))

        # stack`
        stacked_data = np.stack((r_channel, g_channel, b_channel), axis=-1)

        return stacked_data
        # visualise
        # plt.imshow(stacked_data)
        # plt.title('Radiance Visualisation in RGB from Old Man VNIR')
        # plt.axis('off')
        # plt.show()