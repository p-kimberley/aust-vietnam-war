<?php
/*
 * Plugin Name: AVW Homepage Featured Articles
 * Description: Displays featured articles on the home page
 * Version: 1.0
 * Author: Peter Kimberley
 * Author URI: http://gradata.com.au
 */

class AVW_Homepage_Featured_Articles extends WP_Widget
{
    /**
     * Sets up the widgets name etc
     */
    public function __construct()
    {
        parent::__construct(
            'avw_homepage_featured_articles',
            'AVW Homepage Featured Articles',
            array(
                    'description' => 'Displays featured articles'
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
        $title = $instance['title'];

        if (!empty($title))
        {
            echo('Title: ' . $title);
            echo('123');
        }
    }

    /**
     * Outputs the options form on admin
     *
     * @param array $instance The widget options
     */
    public function form($instance)
    {
        $title = !empty($instance['title']) ? $instance['title'] : esc_html('New title');
        $field_id = $this->get_field_id('title');
        $field_name = $this->get_field_name('title');
        ?>
        <p>
            <label for="<?php echo esc_attr($field_id); ?>"><?php esc_attr('Title:'); ?></label>
            <input class="widefat" id="<?php echo esc_attr($field_id); ?>"
                   name="<?php echo esc_attr($field_name); ?>" type="text"
                   value="<?php echo esc_attr($title); ?>">
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
        $new_title = $new_instance['title'];
        $instance['title'] = (!empty($new_title) ? strip_tags($new_title) : '');

        return $instance;
    }
}

function register_avw_homepage_featured_articles()
{
    register_widget('AVW_Homepage_Featured_Articles');
}

add_action('widgets_init', 'register_avw_homepage_featured_articles');