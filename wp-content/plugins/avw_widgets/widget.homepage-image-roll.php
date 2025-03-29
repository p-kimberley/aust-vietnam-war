<?php
/*
 * Plugin Name: AVW Homepage Image Roll
 * Description: Shows community-contributed images from the Battle Map
 * Version: 1.0
 * Author: Gradata Systems Pty Ltd
 * Author URI: http://gradata.com.au
 */

class AVW_Homepage_Image_Roll extends WP_Widget
{
    private $defaultMaxImages = 10;
    private $instance;

    /**
     * Sets up the widgets name etc
     */
    public function __construct()
    {
        parent::__construct(
            'avw_homepage_image_roll',
            'AVW Homepage Image Roll',
            array(
                    'description' => 'Shows community-contributed images from the Battle Map'
            )
        );
    }

    /**
     * Outputs the content of the widget
     *
     * @param array $args
     * @param array $instance
     */
    public function widget($args, $instance)
    {
        $this->instance = $instance;

        wp_enqueue_style('lightSlider', '/src/js/vendor/lightslider/css/lightslider.min.css', array(), false, 'all');
        wp_enqueue_style('lightGallery', '/src/js/vendor/lightgallery/css/lightgallery.min.css', array(), false, 'all');
        wp_enqueue_style('homepage', '/src/css/homepage/homepage.css', array(), false, 'all');
		wp_enqueue_script('jquery', '/src/js/vendor/jquery-3.3.1.min.js', array(), false, false);
        wp_enqueue_script('lightSlider', '/src/js/vendor/lightslider/js/lightslider.min.js', array('jquery'), false, false);
        wp_enqueue_script('lightGallery', '/src/js/vendor/lightgallery/js/lightgallery-all.min.js', array('jquery'), false, false);

        $title = $instance['title'];
        echo '<div class="avw-homepage-widget sidebar-widget ' . $this->id_base . '">';
        ?>

        <!--<h1>Community Images</h1>-->
        <div id="media-slider-container">
            <div id="media-slider">
                <ul></ul>
            </div>
            <div id="media-info">
                <div class="filename"></div>
                <div class="description"><span></span><a href="#" class="show-more">show more</a></div>
            </div>
        </div>

        <?php add_action('wp_footer', function() { ?>
            <!-- Retrieve incident media data from API -->
            <script type="text/javascript">
				jQuery(function($) {
					var maxImages = <?php echo $this->instance['max_images']; ?>;
					var mediaGallery = $('#media-slider');
					var imageList = mediaGallery.find('ul');
					var mediaInfo = $('#media-info');

					$.ajax({
						url: '/api/es/search/avw_incident_media',
						method: 'POST',
						contentType: 'application/json',
						dataType: 'json',
						data: JSON.stringify({
							"size": maxImages,
							"query": {
							    "bool": {
							        "must": [
									{
                                        "wildcard": {
                                            "Mime_Type.raw": {
                                                "value": "image/*"
                                            }
                                        }
                                    },{
                                        "match": {
                                            "Approval_Status": 1
                                        }
                                    }]
                                }
							},
							"sort": [
								{
									"Created": {
										"order": "desc"
									}
								}
							]
						})
					}).done(function(data) {
						$.each(data.hits.hits, function(i, item) {
							var fields = item._source;
							var imageSrc = '/incident-media/' + fields.Path;
							var img = $(document.createElement('img'))
								.attr('src', imageSrc);
							$(document.createElement('li'))
								.attr('data-thumb', imageSrc)
								.attr('data-src', imageSrc)
                                .attr('data-filename', fields.File_Name)
                                .attr('data-description', fields.Description)
								.append(img)
								.appendTo(imageList);
						});

						var description = mediaInfo.find('.description');
						var showMore = description.find('.show-more');

						showMore.click(function(event) {
							event.preventDefault();

							mediaInfo.toggleClass('show-all');
							if (mediaInfo.hasClass('show-all'))
								showMore.text('show less');
							else
								showMore.text('show more');
                        });

						imageList.lightSlider({
							item: 3,
                            auto: false,
							loop: false,
                            speed: 1000,
                            pause: 5000,
                            pauseOnHover: true,
							thumbItem: 9,
                            pager: false,
                            gallery: false,
							slideMargin: 0,
							enableDrag: false,
							currentPagerPosition: 'left',
							responsive: [
								{
									breakpoint: 1600,
									settings: {
										item: 2
									}
								},
                                {
                                	breakpoint: 1300,
                                    settings: {
                                		item: 1
                                    }
                                }
							],
							onSliderLoad: function(el) {
								/*el.lightGallery({
                                 selector: '#media-gallery .lslide'
                                 });*/

                                loadItemInfo(el);
							},
                            onBeforeSlide: function(el) {
								loadItemInfo(el);
                            }
						});

					}).fail(function(error) {
						mediaGallery.text('No images are available');
						console.warn('Image gallery could not be loaded: ' + error);
					});

					function loadItemInfo(el)
					{
						var slide = el.find('li').eq(el.getCurrentSlideCount() - 1);
						var description = mediaInfo.find('.description');
						var descriptionText = description.find('span');
						var showMore = description.find('.show-more');

						showMore.hide();
						showMore.text('show more');
						mediaInfo.removeClass('show-all');
						mediaInfo.find('.filename').text(slide.data('filename'));
						descriptionText.text(slide.data('description'));

						var scrollWidth = description[0].scrollWidth;
						if (descriptionText.width() < scrollWidth)
                        	showMore.hide();
                        else
                        	showMore.show();
					}
				});
            </script>
        <?php });

        echo '</div>';
    }

    /**
     * Outputs the options form on admin
     *
     * @param array $instance The widget options
     */
    public function form($instance)
    {
        $title = !empty($instance['title']) ? $instance['title'] : esc_html('Image Roll');
        $maxImages = !empty($instance['max_images']) ? $instance['max_images'] : esc_html($this->defaultMaxImages);
        $titleFieldId = $this->get_field_id('title');
        $maxImagesFieldId = $this->get_field_id('max_images');
        ?>
        <p>
            <label for="<?php echo esc_attr($titleFieldId); ?>"><?php esc_attr_e('Title:'); ?></label>
            <input type="text" class="widefat" id="<?php echo esc_attr($titleFieldId); ?>"
                   name="<?php echo esc_attr($this->get_field_name('title')); ?>"
                   value="<?php echo esc_attr($title); ?>">
        </p>
        <p>
            <label for="<?php echo esc_attr($maxImagesFieldId); ?>"><?php esc_attr_e('Max Images:'); ?></label>
            <input type="text" class="widefat" id="<?php echo esc_attr($maxImagesFieldId); ?>"
                   name="<?php echo esc_attr($this->get_field_name('max_images')); ?>"
                   value="<?php echo esc_attr($maxImages); ?>">
        </p>
        <?php
    }

    /**
     * Processing widget options on save
     *
     * @param array $new_instance The new options
     * @param array $old_instance The previous options
     */
    public function update($new_instance, $old_instance)
    {
        $instance = array();
        $title = $new_instance['title'];
        $maxImages = $new_instance['max_images'];
        $instance['title'] = (!empty($title) ? strip_tags($title) : '');
        $instance['max_images'] = (!empty($maxImages) ? strip_tags($maxImages) : $this->defaultMaxImages);

        return $instance;
    }
}

add_action('widgets_init', function() {
    register_widget('AVW_Homepage_Image_Roll');
});